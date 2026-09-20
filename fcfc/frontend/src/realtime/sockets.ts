// WebSocket ম্যানেজার — প্রতি চ্যাটে আলাদা সকেট (Durable Object) + একটি ইউজার-হাব সকেট।
// অটো-রিকানেক্ট (এক্সপোনেনশিয়াল ব্যাকঅফ) ও সেন্ড-কিউয়িং অন্তর্ভুক্ত।
import { wsUrl } from '../api/client'

export const handlers = {
  onChat: (_chatId: string, _ev: any) => {},
  onHub: (_ev: any) => {},
  onChatOpen: (_chatId: string) => {},
  onHubOpen: () => {},
}

interface Managed { ws: WebSocket | null; retries: number; want: boolean; outbox: string[]; timer?: any }

const chats = new Map<string, Managed>()
let hub: Managed = { ws: null, retries: 0, want: false, outbox: [] }

function backoff(retries: number) {
  return Math.min(15000, 500 * 2 ** Math.min(retries, 5)) + Math.random() * 300
}

export function connectChat(chatId: string) {
  let m = chats.get(chatId)
  if (!m) { m = { ws: null, retries: 0, want: true, outbox: [] }; chats.set(chatId, m) }
  m.want = true
  openChatSocket(chatId, m)
}

function openChatSocket(chatId: string, m: Managed) {
  if (m.ws && (m.ws.readyState === WebSocket.OPEN || m.ws.readyState === WebSocket.CONNECTING)) return
  try {
    const ws = new WebSocket(wsUrl(`/ws/chat/${chatId}`))
    m.ws = ws
    ws.onopen = () => {
      m!.retries = 0
      handlers.onChatOpen(chatId)
      const queue = m!.outbox.splice(0)
      for (const raw of queue) ws.send(raw)
    }
    ws.onmessage = (e) => {
      try { handlers.onChat(chatId, JSON.parse(e.data)) } catch {}
    }
    ws.onclose = () => {
      m!.ws = null
      if (m!.want) {
        m!.retries++
        m!.timer = setTimeout(() => openChatSocket(chatId, m!), backoff(m!.retries))
      }
    }
    ws.onerror = () => { try { ws.close() } catch {} }
  } catch {
    m.ws = null
    if (m.want) m.timer = setTimeout(() => openChatSocket(chatId, m), backoff(++m.retries))
  }
}

export function disconnectChat(chatId: string) {
  const m = chats.get(chatId)
  if (!m) return
  m.want = false
  clearTimeout(m.timer)
  try { m.ws?.close() } catch {}
  chats.delete(chatId)
}

export function sendChat(chatId: string, obj: any): void {
  const m = chats.get(chatId)
  const raw = JSON.stringify(obj)
  if (m?.ws?.readyState === WebSocket.OPEN) m.ws.send(raw)
  else if (m) m.outbox.push(raw)
}

export function isChatOpen(chatId: string) {
  return chats.get(chatId)?.ws?.readyState === WebSocket.OPEN
}

// ── ইউজার হাব ──
export function connectHub() {
  hub.want = true
  openHub()
}

function openHub() {
  if (hub.ws && (hub.ws.readyState === WebSocket.OPEN || hub.ws.readyState === WebSocket.CONNECTING)) return
  try {
    const ws = new WebSocket(wsUrl('/ws/user'))
    hub.ws = ws
    ws.onopen = () => {
      hub.retries = 0
      handlers.onHubOpen()
      const queue = hub.outbox.splice(0)
      for (const raw of queue) ws.send(raw)
      // হার্টবিট — প্রেজেন্স ধরে রাখে
      ;(ws as any)._hb = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'hb' }))
      }, 45000)
    }
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.t === 'hub') handlers.onHub(msg.event)
      } catch {}
    }
    ws.onclose = () => {
      clearInterval((ws as any)._hb)
      hub.ws = null
      if (hub.want) { hub.retries++; hub.timer = setTimeout(openHub, backoff(hub.retries)) }
    }
    ws.onerror = () => { try { ws.close() } catch {} }
  } catch {
    if (hub.want) hub.timer = setTimeout(openHub, backoff(++hub.retries))
  }
}

export function disconnectHub() {
  hub.want = false
  clearTimeout(hub.timer)
  try { hub.ws?.close() } catch {}
}

export function sendHub(obj: any) {
  const raw = JSON.stringify(obj)
  if (hub.ws?.readyState === WebSocket.OPEN) hub.ws.send(raw)
  else hub.outbox.push(raw)
}
