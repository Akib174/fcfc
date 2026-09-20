// লোকাল/পুশ নোটিফিকেশন হেল্পার + নোটিফিকেশন সাউন্ড (সিন্থেসাইজড পিং)।
import type { Chat, Message } from '../types'
import { useChats } from '../stores/chats'

export function chatTitle(c: Chat): string {
  if (c.kind === 'group') return c.title || 'গ্রুপ'
  return c.peer?.deleted ? 'Deleted account' : c.peer?.username || 'চ্যাট'
}

export function notifyMessage(chat: Chat, msg: Message) {
  try {
    if (!('Notification' in window)) return
    if (Notification.permission !== 'granted') return
    // অ্যাপ ফোকাসে ও একই চ্যাট খোলা থাকলে ট্রে-তে দেখানোর দরকার নেই।
    // (অ্যাপটি হ্যাশ-ভিত্তিক — আগে location.search দেখা হতো, যা কখনোই ম্যাচ করত না)
    if (document.hasFocus() && useChats.getState().activeChatId === msg.chatId) return
    const title = chatTitle(chat)
    const body = msg.body || '(এনক্রিপ্টেড মেসেজ)'
    new Notification(title, {
      body: body.slice(0, 120),
      tag: `msg-${msg.id}`,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { chatId: msg.chatId },
    })
  } catch {}
}

export async function requestNotifyPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'default') await Notification.requestPermission()
  return Notification.permission === 'granted'
}

let audioCtx: AudioContext | null = null
export function playPing() {
  try {
    audioCtx = audioCtx || new AudioContext()
    const t = audioCtx.currentTime
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, t)
    osc.frequency.exponentialRampToValueAtTime(1318, t + 0.08)
    gain.gain.setValueAtTime(0.001, t)
    gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
    osc.connect(gain).connect(audioCtx.destination)
    osc.start(t)
    osc.stop(t + 0.4)
  } catch {}
}
