// /me/* এবং /users/* — প্রোফাইল, সার্চ, ব্লক, ডিভাইস, প্রিকি, কী-ব্যাকআপ, পুশ।
import { Hono } from 'hono'
import type { AppContext } from '../types'
import { json, err, uid, now, b64u } from '../lib/util'
import { authMiddleware } from '../middleware/auth'
import { verifyPassword } from '../lib/password'
import { uploadKeys } from './auth'

const app = new Hono<AppContext>()
app.use('*', authMiddleware)

function publicUser(u: any) {
  return {
    id: u.id, username: u.username, about: u.about || '',
    avatarKey: u.avatar_key || '',
    lastSeenPriv: u.lastseen_priv,
    lastSeenAt: u.lastseen_priv === 'everyone' ? u.last_seen_at : 0,
    deleted: !!u.deleted,
  }
}

// ── প্রোফাইল ──
app.get('/me', async (c) => {
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.get('user').id).first<any>()
  if (!u) return err('not found', 404)
  const settings = await c.env.DB.prepare('SELECT json FROM settings WHERE user_id = ?').bind(u.id).first<any>()
  return json({ user: { ...publicUser(u), privacyDm: u.privacy_dm }, settings: JSON.parse(settings?.json || '{}') })
})

app.patch('/me', async (c) => {
  const b = await c.req.json<any>().catch(() => ({}))
  const me = c.get('user').id
  const ops: any[] = []
  if (typeof b.about === 'string')
    ops.push(c.env.DB.prepare('UPDATE users SET about = ? WHERE id = ?').bind(b.about.slice(0, 200), me))
  if (typeof b.avatarKey === 'string')
    ops.push(c.env.DB.prepare('UPDATE users SET avatar_key = ? WHERE id = ?').bind(b.avatarKey, me))
  if (b.privacyDm === 'everyone' || b.privacyDm === 'request')
    ops.push(c.env.DB.prepare('UPDATE users SET privacy_dm = ? WHERE id = ?').bind(b.privacyDm, me))
  if (b.lastseenPriv === 'everyone' || b.lastseenPriv === 'nobody')
    ops.push(c.env.DB.prepare('UPDATE users SET lastseen_priv = ? WHERE id = ?').bind(b.lastseenPriv, me))
  if (b.settings && typeof b.settings === 'object')
    ops.push(c.env.DB.prepare('INSERT INTO settings (user_id, json) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json').bind(me, JSON.stringify(b.settings)))
  if (ops.length) await c.env.DB.batch(ops)
  return json({ ok: true })
})

// প্রোফাইল ছবি (≤ 5MB) সরাসরি R2-তে
app.post('/me/avatar', async (c) => {
  const blob = await c.req.arrayBuffer()
  if (blob.byteLength > 5 * 1024 * 1024) return err('too large', 413)
  const key = `avatars/${c.get('user').id}/${uid()}.bin`
  await c.env.R2.put(key, blob, { httpMetadata: { contentType: c.req.header('content-type') || 'image/webp' } })
  await c.env.DB.prepare('UPDATE users SET avatar_key = ? WHERE id = ?').bind(key, c.get('user').id).run()
  return json({ key })
})

// ── সার্চ: partial + similar match ──
app.get('/users/search', async (c) => {
  const q = (c.req.query('q') || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
  if (q.length < 2) return json({ results: [] })
  const { results } = await c.env.DB.prepare(
    `SELECT id, username, about, avatar_key, lastseen_priv, last_seen_at, deleted FROM users
     WHERE deleted = 0 AND username LIKE ? COLLATE NOCASE
     ORDER BY (username LIKE ? COLLATE NOCASE) DESC, length(username) ASC LIMIT 20`,
  ).bind(`%${q}%`, `${q}%`).all()
  return json({ results: results.map(publicUser) })
})

// presence: KV ফ্ল্যাগ (UserHub হার্টবিট থেকে সেট হয়)
// ⚠️ এই রুটটি অবশ্যই `/users/:id`-এর **আগে** রেজিস্টার করতে হবে —
// নইলে Hono প্যারামিটার-রুট `:id` আগে ম্যাচ করে এটাকে ঢেকে ফেলে (404)।
app.get('/users/presence', async (c) => {
  const ids = (c.req.query('ids') || '').split(',').filter(Boolean).slice(0, 100)
  const out: Record<string, boolean> = {}
  for (const id of ids) out[id] = !!(await c.env.KV.get(`online:${id}`))
  return json(out)
})

// ── ইউজার পাবলিক প্রোফাইল ──
app.get('/users/:id', async (c) => {
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(c.req.param('id')).first<any>()
  if (!u) return err('not found', 404)
  return json({ user: publicUser(u) })
})

// ── ব্লক লিস্ট ──
app.get('/me/blocked', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.about, u.avatar_key, u.lastseen_priv, u.last_seen_at, u.deleted
     FROM blocked b JOIN users u ON u.id = b.other_id WHERE b.user_id = ?`,
  ).bind(c.get('user').id).all()
  return json({ results: results.map(publicUser) })
})
app.put('/me/blocked/:id', async (c) => {
  await c.env.DB.prepare('INSERT OR IGNORE INTO blocked (user_id, other_id) VALUES (?,?)')
    .bind(c.get('user').id, c.req.param('id')).run()
  return json({ ok: true })
})
app.delete('/me/blocked/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM blocked WHERE user_id = ? AND other_id = ?')
    .bind(c.get('user').id, c.req.param('id')).run()
  return json({ ok: true })
})

// ── ডিভাইস/সেশন ম্যানেজমেন্ট ──
app.get('/me/devices', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, approved, created_at, last_active FROM devices WHERE user_id = ? ORDER BY created_at DESC',
  ).bind(c.get('user').id).all()
  return json({ devices: results, current: c.get('user').deviceId })
})

// রিমোট লগআউট + পেন্ডিং ডিভাইস বাতিল
app.delete('/me/devices/:id', async (c) => {
  const me = c.get('user')
  const target = c.req.param('id')
  if (target === me.deviceId) return err('use /auth/logout?device=1', 400)
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM refresh_tokens WHERE device_id = ? AND user_id = ?').bind(target, me.id),
    c.env.DB.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?').bind(target, me.id),
  ])
  try {
    const id = c.env.USER_HUB.idFromName(me.id)
    await c.env.USER_HUB.get(id).fetch(`https://hub.internal/notify?uid=${encodeURIComponent(me.id)}`, {
      method: 'POST', body: JSON.stringify({ t: 'device-revoked', deviceId: target }),
    })
  } catch {}
  return json({ ok: true })
})

// ── কী-ব্যাকআপ (পাসওয়ার্ড-ডিরাইভড, সার্ভার কখনো ডিক্রিপ্ট করতে পারে না) ──
app.get('/me/backup', async (c) => {
  const row = await c.env.DB.prepare('SELECT blob, salt FROM key_backups WHERE user_id = ?').bind(c.get('user').id).first<any>()
  return json(row || { blob: null })
})
app.put('/me/backup', async (c) => {
  const { blob, salt } = await c.req.json<any>()
  if (!blob || !salt) return err('missing blob/salt')
  await c.env.DB.prepare(
    'INSERT INTO key_backups (user_id, blob, salt, updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET blob = excluded.blob, salt = excluded.salt, updated_at = excluded.updated_at',
  ).bind(c.get('user').id, blob, salt, now()).run()
  return json({ ok: true })
})

// ── প্রিকি (X3DH বান্ডল) ──
app.get('/users/:id/prekeys', async (c) => {
  const id = c.req.param('id')
  const k = await c.env.DB.prepare('SELECT * FROM user_keys WHERE user_id = ?').bind(id).first<any>()
  if (!k) return err('no keys', 404)
  // একটি ওয়ান-টাইম প্রিকি ক্লেম করা হয়
  const otk = await c.env.DB.prepare(
    'SELECT id, pub FROM one_time_prekeys WHERE user_id = ? AND claimed = 0 ORDER BY id LIMIT 1',
  ).bind(id).first<any>()
  if (otk) await c.env.DB.prepare('UPDATE one_time_prekeys SET claimed = 1 WHERE id = ?').bind(otk.id).run()
  return json({
    identityPub: JSON.parse(k.identity_pub),
    signPub: JSON.parse(k.sign_pub),
    spkPub: JSON.parse(k.spk_pub),
    spkSig: k.spk_sig,
    opkPub: otk ? JSON.parse(otk.pub) : null,
  })
})

app.post('/me/keys', async (c) => {
  await uploadKeys(c.env, c.get('user').id, await c.req.json())
  return json({ ok: true })
})

// ── Web Push সাবস্ক্রিপশন ──
app.post('/me/push/subscribe', async (c) => {
  const { endpoint, keys } = await c.req.json<any>()
  if (!endpoint || !keys?.p256dh || !keys?.auth) return err('bad subscription')
  await c.env.DB.prepare(
    'INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?)',
  ).bind(uid('p_'), c.get('user').id, endpoint, keys.p256dh, keys.auth, now()).run()
  return json({ ok: true })
})
app.get('/push/vapid-public', (c) => json({ key: c.env.VAPID_PUBLIC_KEY || '' }))

// ── অ্যাকাউন্ট ডিলিট (পাসওয়ার্ড কনফার্ম) ──
app.delete('/me/account', async (c) => {
  const { password } = await c.req.json<any>()
  const me = c.get('user').id
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(me).first<any>()
  if (!u || !(await verifyPassword(String(password || ''), u.pass_hash, u.pass_salt)))
    return err('wrong password', 403)
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET deleted = 1, about = '', avatar_key = '', pass_hash = '', pass_salt = '' WHERE id = ?`).bind(me),
    c.env.DB.prepare('DELETE FROM user_keys WHERE user_id = ?').bind(me),
    c.env.DB.prepare('DELETE FROM one_time_prekeys WHERE user_id = ?').bind(me),
    c.env.DB.prepare('DELETE FROM key_backups WHERE user_id = ?').bind(me),
    c.env.DB.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').bind(me),
    c.env.DB.prepare('DELETE FROM devices WHERE user_id = ?').bind(me),
    c.env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').bind(me),
    c.env.DB.prepare('DELETE FROM settings WHERE user_id = ?').bind(me),
    c.env.DB.prepare('DELETE FROM chat_members WHERE user_id = ?').bind(me),
  ])
  // প্রোফাইল ছবিও মুছে ফেলা হয়
  if (u.avatar_key) await c.env.R2.delete(u.avatar_key).catch(() => {})
  return json({ ok: true })
})

export default app
