// /chats/* — DM ও গ্রুপ ম্যানেজমেন্ট, ইনভাইট লিংক, মেসেজ রিকোয়েস্ট, চ্যাট-স্টেট, হিস্টোরি।
import { Hono } from 'hono'
import type { AppContext, Env } from '../types'
import { json, err, uid, now } from '../lib/util'
import { authMiddleware } from '../middleware/auth'
import { rateLimit } from '../lib/ratelimit'

const app = new Hono<AppContext>()
app.use('*', authMiddleware)

async function isMember(env: Env, chatId: string, userId: string) {
  return !!(await env.DB.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').bind(chatId, userId).first())
}
async function memberRole(env: Env, chatId: string, userId: string): Promise<string | null> {
  const r = await env.DB.prepare('SELECT role FROM chat_members WHERE chat_id = ? AND user_id = ?').bind(chatId, userId).first<any>()
  return r?.role || null
}
function isAdmin(role: string | null) { return role === 'owner' || role === 'admin' }

async function notifyHub(env: Env, userId: string, event: any) {
  try {
    const id = env.USER_HUB.idFromName(userId)
    await env.USER_HUB.get(id).fetch(`https://hub.internal/notify?uid=${encodeURIComponent(userId)}`, { method: 'POST', body: JSON.stringify(event) })
  } catch {}
}

async function memberIds(env: Env, chatId: string): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').bind(chatId).all()
  return results.map((r: any) => r.user_id)
}

async function ensureState(env: Env, userId: string, chatId: string) {
  await env.DB.prepare('INSERT OR IGNORE INTO chat_state (user_id, chat_id) VALUES (?,?)').bind(userId, chatId).run()
}

// ── চ্যাট তৈরি: DM বা গ্রুপ ──
app.post('/chats', async (c) => {
  const rl = await rateLimit(c.env.KV, `mkchat:${c.get('user').id}`, 20, 60)
  if (!rl.ok) return err('rate limited', 429)
  const me = c.get('user').id
  const b = await c.req.json<any>()

  if (b.kind === 'dm') {
    const peerId = String(b.with || '')
    if (peerId === me) return err('cannot dm self')
    const peer = await c.env.DB.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0').bind(peerId).first<any>()
    if (!peer) return err('user not found', 404)
    const blocked = await c.env.DB.prepare('SELECT 1 FROM blocked WHERE (user_id=? AND other_id=?) OR (user_id=? AND other_id=?)')
      .bind(me, peerId, peerId, me).first()
    if (blocked) return err('blocked', 403)

    const [a, b_] = [me, peerId].sort()
    const existing = await c.env.DB.prepare('SELECT chat_id FROM dm_index WHERE a = ? AND b = ?').bind(a, b_).first<any>()
    if (existing) { await ensureState(c.env, me, existing.chat_id); return json({ chatId: existing.chat_id }) }

    // Privacy: "Request Only" হলে আগে মেসেজ রিকোয়েস্ট যেতে হবে
    if (peer.privacy_dm === 'request') {
      const reqId = uid('rq_')
      const chatId = uid('c_')
      await c.env.DB.batch([
        c.env.DB.prepare('INSERT INTO chats (id, kind, created_by, created_at) VALUES (?,?,?,?)').bind(chatId, 'dm', me, now()),
        c.env.DB.prepare('INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?),(?,?,?,?)')
          .bind(chatId, me, 'member', now(), chatId, peerId, 'member', now()),
        c.env.DB.prepare('INSERT INTO dm_index (a, b, chat_id) VALUES (?,?,?)').bind(a, b_, chatId),
        c.env.DB.prepare('INSERT INTO message_requests (id, from_user, to_user, chat_id, created_at) VALUES (?,?,?,?,?)')
          .bind(reqId, me, peerId, chatId, now()),
      ])
      await notifyHub(c.env, peerId, { t: 'message-request', requestId: reqId, from: me })
      return json({ request: true, requestId: reqId, chatId })
    }

    const chatId = uid('c_')
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO chats (id, kind, created_by, created_at) VALUES (?,?,?,?)').bind(chatId, 'dm', me, now()),
      c.env.DB.prepare('INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?),(?,?,?,?)')
        .bind(chatId, me, 'member', now(), chatId, peerId, 'member', now()),
      c.env.DB.prepare('INSERT INTO dm_index (a, b, chat_id) VALUES (?,?,?)').bind(a, b_, chatId),
    ])
    await ensureState(c.env, me, chatId)
    await notifyHub(c.env, peerId, { t: 'chat-new', chatId, from: me })
    return json({ chatId })
  }

  if (b.kind === 'group') {
    const title = String(b.title || '').trim().slice(0, 80)
    if (!title) return err('title required')
    const chatId = uid('c_')
    const limit = Math.min(Math.max(parseInt(b.memberLimit || '200', 10) || 200, 2), 1000)
    const members: string[] = [...new Set([me, ...(b.memberIds || [])].map(String))].slice(0, limit)
    const stmts: any[] = [
      c.env.DB.prepare('INSERT INTO chats (id, kind, title, description, created_by, created_at, member_limit) VALUES (?,?,?,?,?,?,?)')
        .bind(chatId, 'group', title, String(b.description || '').slice(0, 500), me, now(), limit),
    ]
    for (const m of members) stmts.push(c.env.DB.prepare('INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)')
      .bind(chatId, m, m === me ? 'owner' : 'member', now()))
    await c.env.DB.batch(stmts)
    for (const m of members) {
      await ensureState(c.env, m, chatId)
      if (m !== me) await notifyHub(c.env, m, { t: 'chat-new', chatId, from: me })
    }
    return json({ chatId })
  }
  return err('bad kind')
})

// ── আমার চ্যাট লিস্ট ──
app.get('/chats', async (c) => {
  const me = c.get('user').id
  const { results } = await c.env.DB.prepare(
    `SELECT c.*, cs.pinned, cs.archived, cs.muted_until, cs.wallpaper, cs.ttl, cs.deleted_before, cs.unread, cs.last_read_ts,
            cm.role
     FROM chat_members cm
     JOIN chats c ON c.id = cm.chat_id
     LEFT JOIN chat_state cs ON cs.chat_id = c.id AND cs.user_id = ?
     WHERE cm.user_id = ? ORDER BY c.last_ts DESC LIMIT 300`,
  ).bind(me, me).all()
  return json({ chats: results })
})

// ── চ্যাট ডিটেইল + মেম্বার ──
app.get('/chats/:id', async (c) => {
  const me = c.get('user').id
  const chat = await c.env.DB.prepare('SELECT * FROM chats WHERE id = ?').bind(c.req.param('id')).first<any>()
  if (!chat) return err('not found', 404)
  if (!(await isMember(c.env, chat.id, me))) return err('not a member', 403)
  const { results: members } = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.about, u.avatar_key, u.deleted, cm.role
     FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ?`,
  ).bind(chat.id).all()
  return json({ chat, members })
})

// ── হিস্টোরি (এনক্রিপ্টেড রো) ──
app.get('/chats/:id/messages', async (c) => {
  const me = c.get('user').id
  const chatId = c.req.param('id')
  if (!(await isMember(c.env, chatId, me))) return err('not a member', 403)
  const st = await c.env.DB.prepare('SELECT deleted_before FROM chat_state WHERE user_id = ? AND chat_id = ?').bind(me, chatId).first<any>()
  const before = parseInt(c.req.query('before') || '', 10) || Number.MAX_SAFE_INTEGER
  const { results } = await c.env.DB.prepare(
    'SELECT mid, sender_id, ts, type, payload FROM messages WHERE chat_id = ? AND ts < ? AND ts > ? AND deleted = 0 ORDER BY ts DESC LIMIT ?',
  ).bind(chatId, before, st?.deleted_before || 0, Math.min(parseInt(c.req.query('limit') || '80', 10), 200)).all()
  return json({ messages: results.reverse() })
})

// ── গ্রুপ অ্যাডমিন অপারেশন ──
app.patch('/chats/:id', async (c) => {
  const me = c.get('user').id
  const chatId = c.req.param('id')
  if (!isAdmin(await memberRole(c.env, chatId, me))) return err('admin only', 403)
  const b = await c.req.json<any>()
  const ops: any[] = []
  if (typeof b.title === 'string') ops.push(c.env.DB.prepare('UPDATE chats SET title = ? WHERE id = ?').bind(b.title.slice(0, 80), chatId))
  if (typeof b.description === 'string') ops.push(c.env.DB.prepare('UPDATE chats SET description = ? WHERE id = ?').bind(b.description.slice(0, 500), chatId))
  if (typeof b.photoKey === 'string') ops.push(c.env.DB.prepare('UPDATE chats SET photo_key = ? WHERE id = ?').bind(b.photoKey, chatId))
  if (parseInt(b.memberLimit, 10)) ops.push(c.env.DB.prepare('UPDATE chats SET member_limit = ? WHERE id = ?').bind(Math.min(parseInt(b.memberLimit, 10), 1000), chatId))
  if (ops.length) await c.env.DB.batch(ops)
  for (const m of await memberIds(c.env, chatId)) await notifyHub(c.env, m, { t: 'chat-updated', chatId })
  return json({ ok: true })
})

app.post('/chats/:id/members', async (c) => {
  const me = c.get('user').id
  const chatId = c.req.param('id')
  const chat = await c.env.DB.prepare('SELECT * FROM chats WHERE id = ?').bind(chatId).first<any>()
  if (!chat) return err('chat not found', 404)
  if (!isAdmin(await memberRole(c.env, chatId, me))) return err('admin only', 403)
  const { userIds } = await c.req.json<any>()
  const count = await c.env.DB.prepare('SELECT COUNT(*) n FROM chat_members WHERE chat_id = ?').bind(chatId).first<any>()
  const toAdd: string[] = (userIds || []).slice(0, Math.max(0, chat.member_limit - count.n))
  const stmts = toAdd.map((u: string) =>
    c.env.DB.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)').bind(chatId, u, 'member', now()))
  if (stmts.length) await c.env.DB.batch(stmts)
  for (const u of toAdd) { await ensureState(c.env, u, chatId); await notifyHub(c.env, u, { t: 'chat-new', chatId, from: me }) }
  for (const m of await memberIds(c.env, chatId)) await notifyHub(c.env, m, { t: 'members-changed', chatId, added: toAdd })
  return json({ ok: true, added: toAdd })
})

app.delete('/chats/:id/members/:uid', async (c) => {
  const me = c.get('user').id
  const chatId = c.req.param('id')
  const target = c.req.param('uid')
  const myRole = await memberRole(c.env, chatId, me)
  if (target !== me && !isAdmin(myRole)) return err('forbidden', 403)
  if (target !== me && myRole === 'admin') {
    const targetRole = await memberRole(c.env, chatId, target)
    if (isAdmin(targetRole)) return err('cannot remove admin', 403)
  }
  await c.env.DB.prepare('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?').bind(chatId, target).run()
  for (const m of await memberIds(c.env, chatId)) await notifyHub(c.env, m, { t: 'members-changed', chatId, removed: [target] })
  await notifyHub(c.env, target, { t: 'removed-from-chat', chatId })
  return json({ ok: true })
})

app.post('/chats/:id/admin', async (c) => {
  const me = c.get('user').id
  const chatId = c.req.param('id')
  if ((await memberRole(c.env, chatId, me)) !== 'owner') return err('owner only', 403)
  const { userId, admin } = await c.req.json<any>()
  await c.env.DB.prepare('UPDATE chat_members SET role = ? WHERE chat_id = ? AND user_id = ?')
    .bind(admin ? 'admin' : 'member', chatId, userId).run()
  for (const m of await memberIds(c.env, chatId)) await notifyHub(c.env, m, { t: 'members-changed', chatId })
  return json({ ok: true })
})

// ── ইনভাইট লিংক ──
app.post('/chats/:id/invites', async (c) => {
  const me = c.get('user').id
  const chatId = c.req.param('id')
  if (!isAdmin(await memberRole(c.env, chatId, me))) return err('admin only', 403)
  const code = uid('')
  await c.env.DB.prepare('INSERT INTO invite_links (code, chat_id, created_by, created_at) VALUES (?,?,?,?)')
    .bind(code, chatId, me, now()).run()
  return json({ code })
})
app.get('/chats/:id/invites', async (c) => {
  const me = c.get('user').id
  if (!isAdmin(await memberRole(c.env, c.req.param('id'), me))) return err('admin only', 403)
  const { results } = await c.env.DB.prepare('SELECT code, uses, created_at, active FROM invite_links WHERE chat_id = ?').bind(c.req.param('id')).all()
  return json({ invites: results })
})
app.delete('/invites/:code', authMiddleware, async (c) => {
  await c.env.DB.prepare('UPDATE invite_links SET active = 0 WHERE code = ? AND created_by = ?')
    .bind(c.req.param('code'), c.get('user').id).run()
  return json({ ok: true })
})
app.post('/invites/:code/join', async (c) => {
  const me = c.get('user').id
  const inv = await c.env.DB.prepare('SELECT * FROM invite_links WHERE code = ? AND active = 1').bind(c.req.param('code')).first<any>()
  if (!inv) return err('invalid link', 404)
  const chat = await c.env.DB.prepare('SELECT * FROM chats WHERE id = ?').bind(inv.chat_id).first<any>()
  if (!chat) return err('chat gone', 404)
  const count = await c.env.DB.prepare('SELECT COUNT(*) n FROM chat_members WHERE chat_id = ?').bind(chat.id).first<any>()
  if (count.n >= chat.member_limit) return err('group full', 409)
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT OR IGNORE INTO chat_members (chat_id, user_id, role, joined_at) VALUES (?,?,?,?)').bind(chat.id, me, 'member', now()),
    c.env.DB.prepare('UPDATE invite_links SET uses = uses + 1 WHERE code = ?').bind(inv.code),
  ])
  await ensureState(c.env, me, chat.id)
  for (const m of await memberIds(c.env, chat.id)) await notifyHub(c.env, m, { t: 'members-changed', chatId: chat.id, added: [me] })
  return json({ chatId: chat.id })
})

// ── মেসেজ রিকোয়েস্ট ──
app.get('/me/requests', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, u.username, u.about, u.avatar_key FROM message_requests r
     JOIN users u ON u.id = r.from_user WHERE r.to_user = ? AND r.status = 'pending'`,
  ).bind(c.get('user').id).all()
  return json({ requests: results })
})
app.post('/requests/:id/accept', async (c) => {
  const me = c.get('user').id
  const r = await c.env.DB.prepare('SELECT * FROM message_requests WHERE id = ? AND to_user = ? AND status = ?')
    .bind(c.req.param('id'), me, 'pending').first<any>()
  if (!r) return err('not found', 404)
  await c.env.DB.prepare(`UPDATE message_requests SET status = 'accepted' WHERE id = ?`).bind(r.id).run()
  await notifyHub(c.env, r.from_user, { t: 'request-accepted', chatId: r.chat_id, by: me })
  return json({ chatId: r.chat_id })
})
app.post('/requests/:id/decline', async (c) => {
  const me = c.get('user').id
  await c.env.DB.prepare(`UPDATE message_requests SET status = 'declined' WHERE id = ? AND to_user = ?`)
    .bind(c.req.param('id'), me).run()
  return json({ ok: true })
})

// ── পার-ইউজার চ্যাট স্টেট: পিন/আর্কাইভ/মিউট/ওয়ালপেপার/টাইমার/লোকাল-ডিলিট ──
app.patch('/me/chats/:id/state', async (c) => {
  const me = c.get('user').id
  const chatId = c.req.param('id')
  await ensureState(c.env, me, chatId)
  const b = await c.req.json<any>()
  const ops: any[] = []
  if (typeof b.pinned === 'boolean') ops.push(c.env.DB.prepare('UPDATE chat_state SET pinned = ? WHERE user_id = ? AND chat_id = ?').bind(b.pinned ? 1 : 0, me, chatId))
  if (typeof b.archived === 'boolean') ops.push(c.env.DB.prepare('UPDATE chat_state SET archived = ? WHERE user_id = ? AND chat_id = ?').bind(b.archived ? 1 : 0, me, chatId))
  if (typeof b.mutedUntil === 'number') ops.push(c.env.DB.prepare('UPDATE chat_state SET muted_until = ? WHERE user_id = ? AND chat_id = ?').bind(b.mutedUntil, me, chatId))
  // ওয়ালপেপার: URL অথবা ক্লায়েন্ট-কমপ্রেসড ডেটা-URL। ২০০০ অক্ষরে কাটলে
  // ডেটা-URL নীরবে ভেঙে যেত — D1-এর স্টেটমেন্ট-লিমিটের নিরাপদ নিচে রাখি।
  if (typeof b.wallpaper === 'string') ops.push(c.env.DB.prepare('UPDATE chat_state SET wallpaper = ? WHERE user_id = ? AND chat_id = ?').bind(b.wallpaper.slice(0, 100_000), me, chatId))
  if (typeof b.ttl === 'number') ops.push(c.env.DB.prepare('UPDATE chat_state SET ttl = ? WHERE user_id = ? AND chat_id = ?').bind(b.ttl, me, chatId))
  if (typeof b.unread === 'number') ops.push(c.env.DB.prepare('UPDATE chat_state SET unread = ? WHERE user_id = ? AND chat_id = ?').bind(b.unread, me, chatId))
  if (typeof b.lastReadTs === 'number') ops.push(c.env.DB.prepare('UPDATE chat_state SET last_read_ts = ? WHERE user_id = ? AND chat_id = ?').bind(b.lastReadTs, me, chatId))
  if (b.deleteForMe) ops.push(c.env.DB.prepare('UPDATE chat_state SET deleted_before = ?, unread = 0, pinned = 0, archived = 0 WHERE user_id = ? AND chat_id = ?').bind(now(), me, chatId))
  if (ops.length) await c.env.DB.batch(ops)
  return json({ ok: true })
})

export default app
