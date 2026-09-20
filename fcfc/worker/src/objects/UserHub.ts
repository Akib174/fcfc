// UserHub — প্রতিটি ইউজারের জন্য একটি করে Durable Object।
// কাজ: (১) ইউজারের সব ডিভাইসের নোটিফিকেশন চ্যানেল (নতুন ডিভাইস অ্যাপ্রুভাল,
// মেসেজ রিকোয়েস্ট, কল, অন্যান্য চ্যাটের মেসেজ), (২) অনলাইন প্রেজেন্স (KV হার্টবিট),
// (৩) অফলাইন হলে Web Push পাঠানো।
import { verifyTokenRaw } from '../middleware/auth'
import { pushToUser } from '../lib/push'

const PUSHABLE = new Set(['msg', 'device-approval', 'message-request', 'request-accepted', 'chat-new'])

export class UserHub {
  private state: DurableObjectState
  private env: any
  private sockets = new Set<WebSocket>()
  private userId: string

  constructor(state: DurableObjectState, env: any) {
    this.state = state
    this.env = env
    this.userId = ''
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.headers.get('upgrade') === 'websocket') {
      const user = await verifyTokenRaw(this.env, url.searchParams.get('token') || '')
      if (!user) return new Response('unauthorized', { status: 401 })
      // হাবের নামই ইউজার আইডি (idFromName(user.id)) — টোকেনের ইউজার মিলতে হবে
      const pair = new WebSocketPair()
      const server = pair[1]
      this.state.acceptWebSocket(server)
      this.sockets.add(server)
      await this.env.KV.put(`online:${user.id}`, '1', { expirationTtl: 180 })
      this.userId = user.id
      // ক্লায়েন্টকে মেসেজ সার্ভার-সকেট (pair[1]) দিয়েই পাঠাতে হয়
      server.send(JSON.stringify({ t: 'hello' }))
      return new Response(null, { status: 101, webSocket: pair[0] })
    }

    if (request.method === 'POST' && url.pathname === '/notify') {
      const event = await request.json<any>().catch(() => null)
      if (!event) return new Response('bad', { status: 400 })
      const uid = this.userId || url.searchParams.get('uid') || ''
      if (this.sockets.size > 0) {
        const data = JSON.stringify({ t: 'hub', event })
        for (const ws of this.sockets) { try { ws.send(data) } catch {} }
      } else if (PUSHABLE.has(event.t)) {
        // অ্যাপ বন্ধ থাকলেও ডিভাইস ট্রে-তে পুশ যাবে
        const title = pushTitle(event)
        await pushToUser(this.env, this.env.DB, uid || this.hubUserId(), {
          title: title[0], body: title[1], tag: `${event.t}-${event.chatId || event.deviceId || uid}`,
          data: { t: event.t, chatId: event.chatId },
        }).catch(() => {})
      }
      return new Response('ok')
    }

    if (request.method === 'GET' && url.pathname === '/online') {
      return new Response(JSON.stringify({ online: this.sockets.size > 0 }), { headers: { 'content-type': 'application/json' } })
    }
    return new Response('hub')
  }

  private hubUserId(): string {
    // DO-এর নাম হিসেবে ইউজার আইডি থাকে; রানটাইমে পাওয়া না গেলে ফলব্যাক ''
    return this.userId || ''
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    try {
      const msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
      if (msg.t === 'hb' && this.userId) {
        await this.env.KV.put(`online:${this.userId}`, '1', { expirationTtl: 180 })
      }
      if (msg.t === 'seen' && msg.chatId) {
        // লাস্ট-সিন আপডেট
        if (this.userId) await this.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(Date.now(), this.userId).run()
      }
    } catch {}
  }

  async webSocketClose(ws: WebSocket) {
    this.sockets.delete(ws)
    if (this.sockets.size === 0 && this.userId) {
      await this.env.KV.delete(`online:${this.userId}`)
      await this.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(Date.now(), this.userId).run().catch(() => {})
    }
  }
}

function pushTitle(event: any): [string, string] {
  switch (event.t) {
    case 'device-approval': return ['fcfc: নতুন ডিভাইস লগইন', `"${event.deviceName || 'নতুন ডিভাইস'}" থেকে লগইন করতে চাইছে — Accept/Decline করুন`]
    case 'message-request': return ['fcfc: নতুন মেসেজ রিকোয়েস্ট', 'একজন আপনাকে মেসেজ পাঠাতে চেয়েছেন']
    case 'request-accepted': return ['fcfc', 'আপনার রিকোয়েস্ট গৃহীত হয়েছে — চ্যাট শুরু করুন']
    case 'chat-new': return ['fcfc', 'আপনাকে একটি নতুন চ্যাটে যোগ করা হয়েছে']
    case 'msg': return ['fcfc', 'নতুন মেসেজ এসেছে']
    default: return ['fcfc', 'নতুন নোটিফিকেশন']
  }
}
