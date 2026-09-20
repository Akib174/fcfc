// /auth/* — signup, login (multi-device approval), refresh, sessions.
import { Hono } from 'hono'
import type { AppContext, Env } from '../types'
import { json, err, uid, now, USERNAME_RE, randHex, b64u } from '../lib/util'
import { hashPassword, verifyPassword } from '../lib/password'
import { signJwt } from '../lib/jwt'
import { makeAccessToken } from '../middleware/auth'
import { rateLimit } from '../lib/ratelimit'
import { pushToUser } from '../lib/push'
import { authMiddleware } from '../middleware/auth'

const app = new Hono<AppContext>()

async function notifyUserHub(env: Env, userId: string, event: any) {
  try {
    const id = env.USER_HUB.idFromName(userId)
    await env.USER_HUB.get(id).fetch(`https://hub.internal/notify?uid=${encodeURIComponent(userId)}`, {
      method: 'POST',
      body: JSON.stringify(event),
    })
  } catch { /* hub unreachable — push handled elsewhere */ }
}

async function hashRefresh(env: Env, token: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token + env.REFRESH_PEPPER))
  return b64u(buf)
}

async function issueTokens(env: Env, userId: string, username: string, deviceId: string) {
  const access = await makeAccessToken(env, userId, username, deviceId)
  const refresh = randHex(32)
  const refreshHash = await hashRefresh(env, refresh)
  await env.DB.prepare(
    'INSERT INTO refresh_tokens (token_hash, user_id, device_id, created_at, expires_at) VALUES (?,?,?,?,?)',
  ).bind(refreshHash, userId, deviceId, now(), now() + 90 * 864e5).run()
  return { access, refresh }
}

// ── username availability (real-time check during signup) ──
app.get('/check', async (c) => {
  const u = (c.req.query('username') || '').toLowerCase()
  if (!USERNAME_RE.test(u)) return json({ ok: false, reason: 'invalid' })
  const row = await c.env.DB.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').bind(u).first()
  return json({ ok: !row })
})

// ── signup ──
app.post('/signup', async (c) => {
  const rl = await rateLimit(c.env.KV, `signup:${c.req.header('cf-connecting-ip') || 'x'}`, 10, 3600)
  if (!rl.ok) return err('rate limited', 429)
  const body = await c.req.json<any>().catch(() => ({}))
  const username = String(body.username || '').toLowerCase()
  const password = String(body.password || '')
  const understood = body.understood === true
  if (!USERNAME_RE.test(username)) return err('invalid username')
  if (password.length < 8) return err('password too short (min 8)')
  if (!understood) return err('recovery acknowledgement required')

  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').bind(username).first()
  if (exists) return err('username taken', 409)

  const { hash, salt } = await hashPassword(password)
  const userId = uid('u_')
  const deviceId = uid('d_')
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO users (id, username, pass_hash, pass_salt, created_at) VALUES (?,?,?,?,?)',
    ).bind(userId, username, hash, salt, now()),
    c.env.DB.prepare(
      'INSERT INTO devices (id, user_id, name, approved, created_at, last_active) VALUES (?,?,?,?,?,?)',
    ).bind(deviceId, userId, body.deviceName || 'New device', 1, now(), now()),
  ])
  // প্রথম ডিভাইস — তাই অনুমোদনের প্রয়োজন নেই।
  if (body.keys) await uploadKeys(c.env, userId, body.keys)

  const tokens = await issueTokens(c.env, userId, username, deviceId)
  return json({ user: { id: userId, username }, ...tokens })
})

// ── login — multi-device approval flow ──
app.post('/login', async (c) => {
  const rl = await rateLimit(c.env.KV, `login:${c.req.header('cf-connecting-ip') || 'x'}`, 20, 300)
  if (!rl.ok) return err('rate limited', 429)
  const body = await c.req.json<any>().catch(() => ({}))
  const username = String(body.username || '').toLowerCase()
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND deleted = 0').bind(username).first<any>()
  if (!user || !(await verifyPassword(String(body.password || ''), user.pass_hash, user.pass_salt)))
    return err('invalid credentials', 401)

  const otherDevices = await c.env.DB.prepare('SELECT COUNT(*) n FROM devices WHERE user_id = ? AND approved = 1').bind(user.id).first<any>()
  const deviceId = uid('d_')
  const secret = randHex(16)

  if (!otherDevices?.n) {
    // একমাত্র ডিভাইস → সাথে সাথেই লগইন।
    await c.env.DB.prepare('INSERT INTO devices (id, user_id, name, approved, created_at, last_active) VALUES (?,?,?,?,?,?)')
      .bind(deviceId, user.id, body.deviceName || 'New device', 1, now(), now()).run()
    const tokens = await issueTokens(c.env, user.id, user.username, deviceId)
    return json({ user: { id: user.id, username: user.username }, ...tokens })
  }

  // অন্য ডিভাইস আছে → নতুন ডিভাইসে অনুমোদন প্রয়োজন।
  await c.env.DB.prepare('INSERT INTO devices (id, user_id, name, secret, approved, created_at) VALUES (?,?,?,?,0,?)')
    .bind(deviceId, user.id, body.deviceName || 'New device', secret, now()).run()
  await notifyUserHub(c.env, user.id, {
    t: 'device-approval', deviceId, deviceName: body.deviceName || 'New device', username: user.username,
  })
  return json({ pending: true, deviceId, secret })
})

// ── নতুন ডিভাইস পোল করে: অনুমোদন হয়েছে কি? ──
app.post('/login/poll', async (c) => {
  const { deviceId, secret } = await c.req.json<any>().catch(() => ({}))
  const dev = await c.env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(deviceId || '').first<any>()
  if (!dev || dev.secret !== secret) return err('unknown device', 404)
  if (dev.approved === 2) return err('declined', 403)
  if (!dev.approved) return json({ pending: true })
  // অ্যাকাউন্ট অনুমোদনের মাঝে ডিলিট হয়ে থাকলে নিরাপদে 401
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0').bind(dev.user_id).first<any>()
  if (!user) return err('account gone', 401)
  await c.env.DB.prepare('UPDATE devices SET secret = NULL, last_active = ? WHERE id = ?').bind(now(), dev.id).run()
  const tokens = await issueTokens(c.env, user.id, user.username, dev.id)
  return json({ user: { id: user.id, username: user.username }, ...tokens })
})

// ── বিদ্যমান ডিভাইস থেকে Accept/Decline ──
app.post('/devices/:id/decision', authMiddleware, async (c) => {
  const { accept } = await c.req.json<any>().catch(() => ({}))
  const dev = await c.env.DB.prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?')
    .bind(c.req.param('id'), c.get('user').id).first<any>()
  if (!dev) return err('not found', 404)
  if (accept) {
    await c.env.DB.prepare('UPDATE devices SET approved = 1, secret = NULL, last_active = ? WHERE id = ?').bind(now(), dev.id).run()
    await notifyUserHub(c.env, c.get('user').id, { t: 'device-accepted', deviceId: dev.id })
  } else {
    await c.env.DB.prepare('UPDATE devices SET approved = 2 WHERE id = ?').bind(dev.id).run()
  }
  return json({ ok: true })
})

// ── refresh ──
app.post('/refresh', async (c) => {
  const { refresh } = await c.req.json<any>().catch(() => ({}))
  if (!refresh) return err('missing refresh', 400)
  const h = await hashRefresh(c.env, refresh)
  const row = await c.env.DB.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ? AND expires_at > ?').bind(h, now()).first<any>()
  if (!row) return err('invalid refresh', 401)
  const dev = await c.env.DB.prepare('SELECT * FROM devices WHERE id = ? AND approved = 1').bind(row.device_id).first<any>()
  if (!dev) return err('device revoked', 401)
  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ? AND deleted = 0').bind(row.user_id).first<any>()
  if (!user) return err('account gone', 401)
  await c.env.DB.prepare('UPDATE devices SET last_active = ? WHERE id = ?').bind(now(), dev.id).run()
  const access = await makeAccessToken(c.env, user.id, user.username, dev.id)
  return json({ access })
})

// ── logout (revoke current device or just token) ──
app.post('/logout', authMiddleware, async (c) => {
  const body = await c.req.json<any>().catch(() => ({}))
  const me = c.get('user')
  if (body.device) {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM refresh_tokens WHERE device_id = ?').bind(me.deviceId!),
      c.env.DB.prepare('DELETE FROM devices WHERE id = ?').bind(me.deviceId!),
    ])
  } else if (body.refresh) {
    const h = await hashRefresh(c.env, String(body.refresh))
    await c.env.DB.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').bind(h).run()
  }
  return json({ ok: true })
})

export async function uploadKeys(env: Env, userId: string, keys: any) {
  const batch: any[] = [
    env.DB.prepare('INSERT OR REPLACE INTO user_keys (user_id, identity_pub, sign_pub, spk_pub, spk_sig, updated_at) VALUES (?,?,?,?,?,?)')
      .bind(userId, JSON.stringify(keys.identityPub), JSON.stringify(keys.signPub), JSON.stringify(keys.spkPub), keys.spkSig, now()),
    env.DB.prepare('DELETE FROM one_time_prekeys WHERE user_id = ?').bind(userId),
  ]
  await env.DB.batch(batch)
  if (Array.isArray(keys.otks)) {
    for (const k of keys.otks) {
      await env.DB.prepare('INSERT INTO one_time_prekeys (user_id, pub) VALUES (?,?)').bind(userId, JSON.stringify(k)).run()
    }
  }
}

export default app
