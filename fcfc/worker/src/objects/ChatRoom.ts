// ChatRoom — প্রতিটি চ্যাট/গ্রুপের জন্য একটি করে Durable Object ইনস্ট্যান্স।
// কাজ: রিয়েল-টাইম মেসেজ রিলে, প্রেজেন্স/টাইপিং, রিসিট, এডিট/ডিলিট-ফর-এভরিওয়ান
// ব্রডকাস্ট (Thanos-vanish), রিয়্যাকশন, পিন, গ্রুপ কল সিগন্যালিং স্টেট।
// মেসেজের বডি এনক্রিপ্টেড — অবজেক্ট কখনো প্লেইনটেক্সট দেখে না।
import { verifyTokenRaw } from '../middleware/auth'

type SocketInfo = { ws: WebSocket; userId: string; chatId: string }

export class ChatRoom {
  private state: DurableObjectState
  private env: any
  private sockets = new Map<WebSocket, SocketInfo>()
  private activeCall: any = null
  private pins: string[] | null = null

  constructor(state: DurableObjectState, env: any) {
    this.state = state
    this.env = env
  }

  private chatIdFromPath(pathname: string) {
    const segs = pathname.split('/').filter(Boolean)
    return segs[segs.length - 1]
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.headers.get('upgrade') === 'websocket') {
      const user = await verifyTokenRaw(this.env, url.searchParams.get('token') || '')
      if (!user) return new Response('unauthorized', { status: 401 })
      const chatId = this.chatIdFromPath(url.pathname)
      const member = await this.env.DB.prepare(
        'SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?',
      ).bind(chatId, user.id).first()
      if (!member) return new Response('forbidden', { status: 403 })

      const pair = new WebSocketPair()
      const server = pair[1]
      this.state.acceptWebSocket(server)
      // রুমের নিজস্ব chatId (URL থেকে) সকেটের সাথে বেঁধে রাখি —
      // ক্লায়েন্ট পাঠানো msg.chatId আর বিশ্বাস করা হয় না (অন্য চ্যাটে
      // লেখা/মুছার সুযোগ বন্ধ)।
      this.sockets.set(server, { ws: server, userId: user.id, chatId })

      if (this.pins === null) this.pins = (await this.state.storage.get<string[]>('pins')) || []
      const wasOffline = ![...this.sockets.values()].some((s) => s.userId === user.id && s.ws !== server)
      server.send(JSON.stringify({ t: 'hello', call: this.activeCall, pins: this.pins }))
      // বর্তমানে রুমে কানেক্টেড সদস্যদের "online" অবস্থা নতুন সকেটকে জানাই —
      // যেন রিকানেক্টের পরেও কারো প্রেজেন্স পুরনো না থাকে
      const seen = new Set<string>()
      for (const s of this.sockets.values()) {
        if (s.userId !== user.id && !seen.has(s.userId)) {
          seen.add(s.userId)
          server.send(JSON.stringify({ t: 'presence', userId: s.userId, online: true }))
        }
      }
      if (wasOffline || this.countSockets(user.id) === 1) {
        this.broadcast({ t: 'presence', userId: user.id, online: true }, user.id)
      }
      return new Response(null, { status: 101, webSocket: pair[0] })
    }

    // অন্য সার্ভিস থেকে আসা ছোট নোটিফিকেশন (যেমন সদস্য পরিবর্তন)
    if (request.method === 'POST') {
      const ev = await request.json<any>().catch(() => null)
      if (ev) this.broadcast(ev)
      return new Response('ok')
    }
    return new Response('chatroom', { status: 200 })
  }

  private countSockets(userId: string) {
    let n = 0
    for (const s of this.sockets.values()) if (s.userId === userId) n++
    return n
  }

  private broadcast(msg: any, exceptUserId?: string) {
    const data = JSON.stringify(msg)
    for (const s of this.sockets.values()) {
      if (exceptUserId && s.userId === exceptUserId) continue
      try { s.ws.send(data) } catch {}
    }
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: any
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)) } catch { return }
    const info = this.sockets.get(ws)
    if (!info) return
    const from = info.userId
    // নিরাপত্তা: chatId সবসময় রুমের নিজস্ব আইডি (কানেক্টের সময় URL থেকে নেওয়া)।
    // ক্লায়েন্ট যা পাঠাক না কেন, এই রুমের বাইরে কোনো চ্যাট টাচ করা যাবে না।
    const chatId = info.chatId

    switch (msg.t) {
      case 'msg': {
        const m = msg.m
        if (!m?.id || !m?.payload) return
        const payload = typeof m.payload === 'string' ? m.payload : JSON.stringify(m.payload)
        const ts = typeof m.ts === 'number' ? m.ts : Date.now()
        try {
          await this.env.DB.batch([
            this.env.DB.prepare(
              'INSERT OR IGNORE INTO messages (mid, chat_id, sender_id, ts, type, payload) VALUES (?,?,?,?,?,?)',
            ).bind(m.id, chatId, from, ts, m.type, payload),
            this.env.DB.prepare('UPDATE chats SET last_ts = ? WHERE id = ?').bind(ts, chatId),
          ])
        } catch {}
        this.broadcast({ t: 'msg', chatId, m: { ...m, senderId: from } })
        // যারা এই রুমে কানেক্টেড না — তাদের হাবে খবর দিই (পুশ/অন্য ডিভাইস)
        const onlineHere = new Set([...this.sockets.values()].map((s) => s.userId))
        await this.fanout(chatId, onlineHere, { t: 'msg', chatId, from, type: m.type, mid: m.id })
        break
      }
      case 'delivered':
      case 'read':
        this.broadcast({ t: msg.t, chatId, from, ids: msg.ids || [] })
        break
      case 'typing':
        this.broadcast({ t: 'typing', chatId, from, on: !!msg.on }, from)
        break
      case 'renego':
        // র‍্যামচেট রি-নেগোসিয়েশন সংকেত — পাঠানোর পক্ষ নতুন হ্যান্ডশেক শুরু করবে
        this.broadcast({ t: 'renego', chatId, from })
        break
      case 'edit': {
        try {
          // পুরনো পেলোডে রিয়্যাকশন জমা থাকে — এডিটে নতুন পেলোড বসানোর সময়
          // সেগুলো বজায় রাখতে হয়, নইলে রিয়্যাকশন হারিয়ে যায়।
          const row = await this.env.DB.prepare('SELECT payload FROM messages WHERE mid = ? AND chat_id = ?').bind(msg.id, chatId).first() as any
          let newPayload = JSON.stringify(msg.payload)
          if (row) {
            try {
              const old = JSON.parse(row.payload)
              if (old && typeof old === 'object' && old.reactions) {
                newPayload = JSON.stringify({ ...msg.payload, reactions: old.reactions })
              }
            } catch {}
          }
          await this.env.DB.prepare('UPDATE messages SET payload = ? WHERE mid = ? AND chat_id = ?')
            .bind(newPayload, msg.id, chatId).run()
        } catch {}
        this.broadcast({ t: 'edit', chatId, from, id: msg.id, payload: msg.payload })
        break
      }
      case 'delAll': {
        // "Delete for everyone" + Thanos-vanish ব্রডকাস্ট — কোনো ট্রেস থাকে না
        const ids = (Array.isArray(msg.ids) ? msg.ids : []).map(String).filter(Boolean)
        try {
          if (ids.length) {
            await this.env.DB.prepare('UPDATE messages SET deleted = 1 WHERE chat_id = ? AND mid IN (' +
              ids.map(() => '?').join(',') + ')').bind(chatId, ...ids).run()
          }
        } catch {}
        this.broadcast({ t: 'delAll', chatId, from, ids })
        break
      }
      case 'react': {
        try {
          const row = await this.env.DB.prepare('SELECT payload FROM messages WHERE mid = ? AND chat_id = ?').bind(msg.id, chatId).first() as any
          if (row) {
            const p = JSON.parse(row.payload)
            p.reactions = p.reactions || {}
            const list: string[] = p.reactions[msg.emoji] || []
            p.reactions[msg.emoji] = msg.on ? [...new Set([...list, from])] : list.filter((u: string) => u !== from)
            if (!p.reactions[msg.emoji].length) delete p.reactions[msg.emoji]
            await this.env.DB.prepare('UPDATE messages SET payload = ? WHERE mid = ? AND chat_id = ?').bind(JSON.stringify(p), msg.id, chatId).run()
          }
        } catch {}
        this.broadcast({ t: 'react', chatId, from, id: msg.id, emoji: msg.emoji, on: !!msg.on })
        break
      }
      case 'pin': {
        if (this.pins === null) this.pins = (await this.state.storage.get<string[]>('pins')) || []
        const mid = String(msg.mid || '')
        this.pins = this.pins.includes(mid) ? this.pins.filter((p) => p !== mid) : [...this.pins.slice(-4), mid]
        await this.state.storage.put('pins', this.pins)
        this.broadcast({ t: 'pins', chatId, pins: this.pins, by: from })
        break
      }
      case 'call': {
        // গ্রুপ/১:১ কল সিগন্যালিং স্টেট — চলমান কলে যেকোনো সময় জয়েন করা যায়
        if (msg.action === 'start') this.activeCall = { ...msg.call, startedBy: from, startedAt: Date.now() }
        if (msg.action === 'end') this.activeCall = null
        this.broadcast({ t: 'call', chatId, from, action: msg.action, call: this.activeCall, participants: msg.participants })
        break
      }
      case 'call-state':
        try { ws.send(JSON.stringify({ t: 'call', chatId, call: this.activeCall })) } catch {}
        break
      case 'seen-req': {
        // গ্রুপে "কে দেখেছে" — ক্লায়েন্ট-সাইড রিসিট থেকে হিসেব হয়; এখানে শুধু অ্যাক
        try { ws.send(JSON.stringify({ t: 'seen-ack', chatId, ids: msg.ids })) } catch {}
        break
      }
    }
  }

  private async fanout(chatId: string, onlineHere: Set<string>, event: any) {
    try {
      const { results } = await this.env.DB.prepare('SELECT user_id FROM chat_members WHERE chat_id = ?').bind(chatId).all()
      for (const r of results) {
        if (onlineHere.has(r.user_id)) continue
        const id = this.env.USER_HUB.idFromName(r.user_id)
        await this.env.USER_HUB.get(id).fetch(`https://hub.internal/notify?uid=${encodeURIComponent(r.user_id)}`, {
          method: 'POST', body: JSON.stringify(event),
        }).catch(() => {})
      }
    } catch {}
  }

  async webSocketClose(ws: WebSocket) {
    const info = this.sockets.get(ws)
    this.sockets.delete(ws)
    if (info && this.countSockets(info.userId) === 0) {
      this.broadcast({ t: 'presence', userId: info.userId, online: false })
      try {
        await this.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(Date.now(), info.userId).run()
      } catch {}
    }
  }
}
