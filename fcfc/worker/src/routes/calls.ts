// /calls/* — Cloudflare Calls (SFU) প্রক্সি।
// ক্লায়েন্ট কখনো CALLS_API_TOKEN দেখে না; সব রিকোয়েস্ট ওয়ার্কারের মাধ্যমে যায়।
// ডোমেইন/টোকেন — কোনোটাই কোডে হার্ডকোড নেই, সব এনভায়রনমেন্ট বাইন্ডিং।
import { Hono } from 'hono'
import type { AppContext, Env } from '../types'
import { json, err } from '../lib/util'
import { authMiddleware } from '../middleware/auth'

const app = new Hono<AppContext>()
app.use('*', authMiddleware)

async function isMember(env: Env, chatId: string, userId: string) {
  return !!(await env.DB.prepare('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?').bind(chatId, userId).first())
}

// নতুন কল সেশন তৈরি (1:1 অথবা গ্রুপ)
app.post('/session', async (c) => {
  const { chatId, offer } = await c.req.json<any>()
  if (!(await isMember(c.env, chatId, c.get('user').id))) return err('not a member', 403)
  const res = await fetch(`${c.env.CALLS_API_BASE}/sessions/new`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${c.env.CALLS_API_TOKEN}` },
    body: JSON.stringify(offer ? { sessionDescription: offer } : {}),
  })
  if (!res.ok) return err('calls api error', 502)
  return json(await res.json<any>())
})

// SDP/tracks renegotiation প্রক্সি (পার্টিসিপ্যান্ট জয়েন, স্ক্রিন শেয়ার ট্র্যাক ইত্যাদি)
app.post('/negotiate', async (c) => {
  const { sessionId, location, body } = await c.req.json<any>()
  if (!sessionId || !location) return err('missing sessionId/location')
  const res = await fetch(`${c.env.CALLS_API_BASE}/locations/${encodeURIComponent(location)}/sessions/${encodeURIComponent(sessionId)}/tracks/new`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${c.env.CALLS_API_TOKEN}` },
    body: JSON.stringify(body || {}),
  })
  if (!res.ok) return err('calls api error', 502)
  return json(await res.json<any>())
})

export default app
