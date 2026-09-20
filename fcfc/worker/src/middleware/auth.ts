// Auth middleware: verifies `Authorization: Bearer <jwt>` or `?token=` (WS/media).
import type { Context } from 'hono'
import { verifyJwt, signJwt } from '../lib/jwt'
import { json } from '../lib/util'
import type { Env } from '../types'

export async function authMiddleware(c: Context, next: () => Promise<void>) {
  const env = c.env as Env
  let token = ''
  const h = c.req.header('authorization') || ''
  if (h.startsWith('Bearer ')) token = h.slice(7)
  if (!token) token = c.req.query('token') || ''
  if (!token) return json({ error: 'unauthorized' }, 401)
  const payload = await verifyJwt(token, env.JWT_SECRET)
  if (!payload || !payload.uid) return json({ error: 'unauthorized' }, 401)
  c.set('user', { id: payload.uid, username: payload.un, deviceId: payload.did })
  await next()
}

export function makeAccessToken(env: Env, userId: string, username: string, deviceId: string) {
  return signJwt({ uid: userId, un: username, did: deviceId }, env.JWT_SECRET, 15 * 60) // 15 min
}

export async function verifyTokenRaw(env: Env, token: string) {
  const p = await verifyJwt(token, env.JWT_SECRET)
  if (!p || !p.uid) return null
  return { id: p.uid as string, username: p.un as string, deviceId: p.did as string }
}
