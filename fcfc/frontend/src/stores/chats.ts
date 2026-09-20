// মূল চ্যাট স্টোর — রিয়েল-টাইম মেসেজ, এনক্রিপশন/ডিক্রিপশন, রিসিট, ভ্যানিশ,
// রিয়্যাকশন, পিন, স্টার, টাইপিং, প্রেজেন্স, সার্চ, এক্সপোর্ট।
import { create } from 'zustand'
import { api } from '../api/client'
import { handlers, connectChat, disconnectChat, sendChat, connectHub } from '../realtime/sockets'
import { encryptFor, decryptFrom, type Envelope } from '../crypto/sessions'
import * as sk from '../crypto/sender'
import { idb } from '../lib/db'
import { uid, URL_RE } from '../lib/utils'
import { useAuth } from './auth'
import { notifyMessage, playPing } from '../lib/notify'
import type { Chat, Message, SendDraft } from '../types'

interface ChatsState {
  booted: boolean
  chats: Record<string, Chat>
  messages: Record<string, Message[]>
  loadedAll: Record<string, boolean>
  activeChatId: string | null
  presence: Record<string, boolean>
  requests: any[]
  vanish: Record<string, boolean>
  starredIds: Record<string, boolean>
  seenBy: Record<string, string[]>
  replyingTo: Message | null

  boot(): Promise<void>
  loadChats(): Promise<void>
  openChat(chatId: string): Promise<void>
  closeChat(): void
  loadHistory(chatId: string, before?: number): Promise<void>
  sendDraft(chatId: string, draft: SendDraft): Promise<void>
  setTyping(on: boolean): void
  editMessage(chatId: string, id: string, text: string): Promise<void>
  deleteForEveryone(chatId: string, ids: string[]): void
  deleteForMe(chatId: string, ids: string[]): void
  finishVanish(chatId: string, ids: string[]): void
  toggleReaction(chatId: string, id: string, emoji: string): void
  toggleStar(msg: Message): Promise<void>
  togglePinMessage(chatId: string, id: string): void
  patchChatState(chatId: string, patch: Record<string, any>): Promise<void>
  markRead(chatId: string): void
  setReplying(m: Message | null): void
  localSearch(q: string): Promise<Message[]>
  starredList(): Promise<Message[]>
  exportChat(chatId: string): Promise<void>
  createDm(userId: string): Promise<{ chatId?: string; request?: boolean }>
  createGroup(title: string, description: string, memberIds: string[], limit?: number): Promise<string>
  joinInvite(code: string): Promise<string>
  respondRequest(id: string, accept: boolean): Promise<void>
  loadRequests(): Promise<void>
  _event(chatId: string, ev: any): void
  _hub(ev: any): void
}

export const useChats = create<ChatsState>((set, get) => ({
  booted: false,
  chats: {},
  messages: {},
  loadedAll: {},
  activeChatId: null,
  presence: {},
  requests: [],
  vanish: {},
  starredIds: {},
  seenBy: {},
  replyingTo: null,

  async boot() {
    if (get().booted) return
    handlers.onChat = (chatId, ev) => get()._event(chatId, ev)
    handlers.onHub = (ev) => get()._hub(ev)
    // (রি)কানেক্ট হলে মিস হওয়া মেসেজ/চ্যাটলিস্ট নিজ থেকেই মিলিয়ে নেওয়া
    handlers.onChatOpen = (chatId) => { get().loadHistory(chatId).catch(() => {}) }
    handlers.onHubOpen = () => { get().loadChats().catch(() => {}); get().loadRequests().catch(() => {}) }
    connectHub()
    set({ booted: true })
    await get().loadChats()
    get().loadRequests()
    const stars = await idb.allKeys('starred')
    const starredIds: Record<string, boolean> = {}
    for (const k of stars) starredIds[String(k)] = true
    set({ starredIds })
  },

  async loadChats() {
    const me = useAuth.getState().user?.id
    const { chats: rows } = await api('/chats')
    const chats: Record<string, Chat> = {}
    for (const r of rows) {
      const c: Chat = {
        id: r.id, kind: r.kind, title: r.title || '', photoKey: r.photo_key || '',
        description: r.description || '', memberLimit: r.member_limit,
        members: [],
        pinned: !!r.pinned, archived: !!r.archived, mutedUntil: r.muted_until || 0,
        wallpaper: r.wallpaper || '', ttl: r.ttl || 0,
        unread: r.unread || 0, lastTs: r.last_ts || 0,
      }
      chats[r.id] = c
    }
    // DM-এর জন্য পিয়ার তথ্য
    const dmChats = rows.filter((r: any) => r.kind === 'dm')
    if (dmChats.length) {
      for (const r of dmChats) {
        try {
          const detail = await api(`/chats/${r.id}`)
          const peer = detail.members.find((m: any) => m.id !== me)
          if (peer) {
            chats[r.id].peer = { id: peer.id, username: peer.username, about: peer.about, avatarKey: peer.avatar_key, deleted: !!peer.deleted }
            chats[r.id].members = detail.members
          }
        } catch {}
      }
    }
    // গ্রুপ মেম্বার (ছোট স্কেল — প্রতি গ্রুপে ১টি কল)
    for (const r of rows.filter((x: any) => x.kind === 'group')) {
      try {
        const detail = await api(`/chats/${r.id}`)
        chats[r.id].members = detail.members
      } catch {}
    }
    set({ chats })
    // লোকাল ক্যাশ থেকে শেষ মেসেজ প্রিভিউ
    for (const id of Object.keys(chats)) {
      const cached = await lastLocalMessage(id)
      if (cached) set((s) => ({ chats: { ...s.chats, [id]: { ...s.chats[id], lastPreview: previewOf(cached), lastTs: cached.ts } } }))
    }
  },

  async openChat(chatId) {
    const me = useAuth.getState().user?.id
    if (!get().chats[chatId]) {
      try {
        const detail = await api(`/chats/${chatId}`)
        const c = detail.chat
        const chat: Chat = {
          id: c.id, kind: c.kind, title: c.title, photoKey: c.photo_key, description: c.description,
          memberLimit: c.member_limit, members: detail.members, unread: 0,
        }
        if (c.kind === 'dm') {
          const peer = detail.members.find((m: any) => m.id !== me)
          if (peer) chat.peer = { id: peer.id, username: peer.username, about: peer.about, avatarKey: peer.avatar_key, deleted: !!peer.deleted }
        }
        set((s) => ({ chats: { ...s.chats, [chatId]: chat } }))
      } catch {}
    }
    set({ activeChatId: chatId })
    connectChat(chatId)
    if (!get().messages[chatId]) {
      set((s) => ({ messages: { ...s.messages, [chatId]: [] } }))
      await get().loadHistory(chatId)
    }
    get().markRead(chatId)
  },

  closeChat() {
    const id = get().activeChatId
    if (id) disconnectChat(id)
    set({ activeChatId: null, replyingTo: null })
  },

  async loadHistory(chatId, before) {
    const rows = await api(`/chats/${chatId}/messages?before=${before || ''}&limit=80`)
    const known = new Set((get().messages[chatId] || []).map((m) => m.id))
    const msgs: Message[] = []
    for (const r of rows.messages) {
      if (known.has(r.mid) || failedDecryptIds.has(r.mid)) continue // আগেই ডিক্রিপ্ট হয়েছে / কখনো হবে না
      const m = await rowToMessage(chatId, r)
      if (m) msgs.push(m)
    }
    set((s) => {
      const existing = s.messages[chatId] || []
      const ids = new Set(msgs.map((m) => m.id))
      const merged = [...msgs, ...existing.filter((m) => !ids.has(m.id))]
      merged.sort((a, b) => a.ts - b.ts)
      // "আর নেই" ফ্ল্যাগ সার্ভার-ফেরত রো-সংখ্যা দিয়ে হিসাব করি — ডিক্রিপ্ট-
      // ব্যর্থ/ডুপ্লিকেট বাদ পড়লেও পেজিনেশন অসময়ে থেমে যেত না।
      return { messages: { ...s.messages, [chatId]: merged }, loadedAll: { ...s.loadedAll, [chatId]: rows.messages.length < 80 } }
    })
  },

  async sendDraft(chatId, draft) {
    const me = useAuth.getState().user!
    const chat = get().chats[chatId]
    if (!chat) return
    const id = uid('m_')
    const ts = Date.now()
    const expiresAt = draft.ttl ? ts + draft.ttl * 1000 : undefined
    const local: Message = {
      id, chatId, senderId: me.id, ts, type: draft.type, body: draft.body,
      media: draft.media, replyTo: draft.replyTo, fwdFrom: draft.fwdFrom,
      reactions: {}, pending: true, expiresAt,
    }
    appendMessage(chatId, local)
    setReplyingPreview(chatId, local)

    try {
      const plain: any = { body: draft.body, media: draft.media, replyTo: draft.replyTo, fwdFrom: draft.fwdFrom, expiresAt }
      let payload: any
      if (chat.kind === 'group') {
        await distributeSenderKeys(chatId, chat)
        payload = await sk.groupEncrypt(chatId, me.id, plain)
      } else {
        if (!chat.peer) throw new Error('no peer')
        payload = await encryptFor(chat.peer.id, plain)
      }
      sendChat(chatId, { t: 'msg', chatId, m: { id, ts, type: draft.type, payload } })
      set((s) => ({ messages: { ...s.messages, [chatId]: (s.messages[chatId] || []).map((m) => m.id === id ? { ...m, pending: false } : m) } }))
    } catch (e) {
      set((s) => ({ messages: { ...s.messages, [chatId]: (s.messages[chatId] || []).map((m) => m.id === id ? { ...m, pending: false, failed: true } : m) } }))
      console.error('send failed', e)
    }
    if (get().replyingTo) set({ replyingTo: null })
  },

  setTyping(on) {
    const chatId = get().activeChatId
    if (chatId) sendChat(chatId, { t: 'typing', chatId, on })
  },

  async editMessage(chatId, id, text) {
    const chat = get().chats[chatId]
    if (!chat) return
    const plain: any = { body: text, edited: true }
    let payload: any
    if (chat.kind === 'group') payload = await sk.groupEncrypt(chatId, useAuth.getState().user!.id, plain)
    else payload = await encryptFor(chat.peer!.id, plain)
    sendChat(chatId, { t: 'edit', chatId, id, payload })
    applyEdit(chatId, id, text)
  },

  // "Delete for everyone" — সব ডিভাইসে Thanos-ভ্যানিশ
  deleteForEveryone(chatId, ids) {
    sendChat(chatId, { t: 'delAll', chatId, ids })
    set((s) => ({ vanish: { ...s.vanish, ...Object.fromEntries(ids.map((i) => [i, true])) } }))
  },

  deleteForMe(chatId, ids) {
    set((s) => ({
      messages: { ...s.messages, [chatId]: (s.messages[chatId] || []).filter((m) => !ids.includes(m.id)) },
    }))
    for (const id of ids) idb.del('messages', id).catch(() => {})
  },

  finishVanish(chatId, ids) {
    set((s) => {
      const v = { ...s.vanish }
      for (const i of ids) delete v[i]
      return {
        vanish: v,
        messages: { ...s.messages, [chatId]: (s.messages[chatId] || []).filter((m) => !ids.includes(m.id)) },
      }
    })
    for (const id of ids) idb.del('messages', id).catch(() => {})
  },

  toggleReaction(chatId, id, emoji) {
    const me = useAuth.getState().user!.id
    // আগে সবসময় on:true পাঠানো হতো — নিজের রিয়্যাকশন সরানোই যেত না।
    // এখন আমার রিয়্যাকশন আগে থেকে থাকলে বন্ধ (off) করি।
    const msg = (get().messages[chatId] || []).find((m) => m.id === id)
    const on = !(msg?.reactions?.[emoji] || []).includes(me)
    sendChat(chatId, { t: 'react', chatId, id, emoji, on })
    applyReaction(chatId, id, emoji, me, on)
  },

  async toggleStar(msg) {
    const on = !get().starredIds[msg.id]
    set((s) => ({ starredIds: { ...s.starredIds, [msg.id]: on } }))
    if (on) await idb.put('starred', msg.id, { ...msg, starred: true })
    else await idb.del('starred', msg.id)
  },

  togglePinMessage(chatId, id) {
    sendChat(chatId, { t: 'pin', chatId, mid: id })
  },

  async patchChatState(chatId, patch) {
    await api(`/me/chats/${chatId}/state`, { method: 'PATCH', body: patch })
    if (patch.deleteForMe) {
      // "চ্যাট ডিলিট (আমার)" — লোকাল স্টেট থেকেও সরিয়ে দিই, নইলে রিলোড
      // পর্যন্ত মেসেজ/প্রিভিউ দেখে থেকে যেত।
      set((s) => {
        const chats = { ...s.chats }; delete chats[chatId]
        const messages = { ...s.messages }; delete messages[chatId]
        return { chats, messages }
      })
      return
    }
    set((s) => ({ chats: { ...s.chats, [chatId]: { ...s.chats[chatId], ...localStateFromPatch(patch) } } }))
  },

  markRead(chatId) {
    const msgs = get().messages[chatId] || []
    const me = useAuth.getState().user?.id
    const unreadIds = msgs.filter((m) => m.senderId !== me).map((m) => m.id)
    if (unreadIds.length) sendChat(chatId, { t: 'read', chatId, ids: unreadIds })
    set((s) => ({ chats: { ...s.chats, [chatId]: { ...s.chats[chatId], unread: 0 } } }))
    api(`/me/chats/${chatId}/state`, { method: 'PATCH', body: { unread: 0, lastReadTs: Date.now() } }).catch(() => {})
  },

  setReplying(m) { set({ replyingTo: m }) },

  async localSearch(q) {
    const all = await idb.all<Message>('messages')
    const needle = q.toLowerCase()
    return all.filter((m) => (m.body || '').toLowerCase().includes(needle)).sort((a, b) => b.ts - a.ts).slice(0, 100)
  },

  async starredList() {
    return (await idb.all<Message>('starred')).sort((a, b) => b.ts - a.ts)
  },

  async exportChat(chatId) {
    const msgs = get().messages[chatId] || []
    const chat = get().chats[chatId]
    const name = (id: string) => chat.members.find((m) => m.id === id)?.username || id
    const lines = msgs.map((m) => `[${new Date(m.ts).toLocaleString()}] ${name(m.senderId)}: ${m.body || `(${m.type})`}`)
    const blob = new Blob([`fcfc chat export — ${chat.title || chat.peer?.username}\n\n${lines.join('\n')}`], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `fcfc-export-${chatId}.txt`
    a.click()
    URL.revokeObjectURL(a.href)
  },

  async createDm(userId) {
    const res = await api('/chats', { body: { kind: 'dm', with: userId } })
    if (res.request) return { request: true }
    await get().loadChats()
    return { chatId: res.chatId }
  },

  async createGroup(title, description, memberIds, limit = 200) {
    const res = await api('/chats', { body: { kind: 'group', title, description, memberIds, memberLimit: limit } })
    await get().loadChats()
    return res.chatId
  },

  async joinInvite(code) {
    if (!code) throw new Error('invite code required')
    const res = await api(`/invites/${code}/join`)
    await get().loadChats()
    return res.chatId
  },

  async respondRequest(id, accept) {
    await api(`/requests/${id}/${accept ? 'accept' : 'decline'}`)
    await get().loadRequests()
    if (accept) await get().loadChats()
  },

  async loadRequests() {
    const { requests } = await api('/me/requests')
    set({ requests })
  },

  // ── ChatRoom WebSocket ইভেন্ট হ্যান্ডলার ──
  async _event(chatId, ev) {
    const me = useAuth.getState().user?.id
    const chat = () => get().chats[chatId]
    switch (ev.t) {
      case 'hello': {
        set((s) => ({ chats: s.chats[chatId] ? { ...s.chats, [chatId]: { ...s.chats[chatId], pins: ev.pins, activeCall: ev.call } } : s.chats }))
        break
      }
      case 'msg': {
        const m = ev.m
        if (m.senderId === me && get().messages[chatId]?.some((x) => x.id === m.id)) return
        const msg = await rowToMessage(chatId, { mid: m.id, sender_id: m.senderId, ts: m.ts, type: m.type, payload: m.payload })
        if (!msg) {
          // ডিক্রিপ্ট ব্যর্থ → পাঠানোর পক্ষকে র‍্যামচেট রি-নেগো করার সংকেত (১০ সেকেন্ডে সর্বোচ্চ ১বার)
          if (m.senderId !== me && Date.now() - (lastRenego[chatId] || 0) > 10000) {
            lastRenego[chatId] = Date.now()
            sendChat(chatId, { t: 'renego', chatId, from: me })
          }
          return
        }
        appendMessage(chatId, msg)
        setReplyingPreview(chatId, msg)
        if (m.senderId !== me) {
          sendChat(chatId, { t: 'delivered', chatId, ids: [m.id] })
          if (get().activeChatId === chatId) {
            get().markRead(chatId)
          } else {
            set((s) => ({ chats: { ...s.chats, [chatId]: { ...s.chats[chatId], unread: (s.chats[chatId]?.unread || 0) + 1 } } }))
            const c = chat()
            if (c && !(c.mutedUntil && c.mutedUntil > Date.now())) {
              notifyMessage(c, msg)
              if (useAuth.getState().settings?.sound !== false) playPing()
            }
          }
        }
        if (msg.expiresAt) scheduleExpiry(chatId, msg.id, msg.expiresAt)
        break
      }
      case 'delivered':
      case 'read': {
        if (ev.from === me) return
        set((s) => {
          const seenBy = { ...s.seenBy }
          if (ev.t === 'read') {
            for (const id of ev.ids) seenBy[id] = [...new Set([...(seenBy[id] || []), ev.from])]
          }
          return {
            seenBy,
            messages: {
              ...s.messages,
              [chatId]: (s.messages[chatId] || []).map((m) =>
                ev.ids.includes(m.id) && m.senderId === me ? { ...m, [ev.t === 'read' ? 'read' : 'delivered']: true } : m),
            },
          }
        })
        break
      }
      case 'typing': {
        if (ev.from === me) return
        set((s) => {
          const c = s.chats[chatId]
          if (!c) return s
          let typing = c.typing || []
          typing = ev.on ? [...new Set([...typing, ev.from])] : typing.filter((u) => u !== ev.from)
          return { chats: { ...s.chats, [chatId]: { ...c, typing } } }
        })
        if (ev.on) setTimeout(() => {
          set((s) => {
            const c = s.chats[chatId]
            if (!c) return s
            return { chats: { ...s.chats, [chatId]: { ...c, typing: (c.typing || []).filter((u) => u !== ev.from) } } }
          })
        }, 6000)
        break
      }
      case 'presence': {
        set((s) => ({ presence: { ...s.presence, [ev.userId]: ev.online } }))
        break
      }
      case 'renego': {
        // ওপক্ষের ডিক্রিপশন ভেঙেছে — ওর সাথে পুরনো র‍্যামচেট সেশন ফেলে দিই,
        // পরের মেসেজটা নতুন হ্যান্ডশেকসহ যাবে
        if (ev.from && ev.from !== me) idb.del('sessions', ev.from).catch(() => {})
        break
      }
      case 'edit': {
        try {
          const c = chat()
          if (!c) return
          const plain = c.kind === 'group'
            ? await sk.groupDecrypt(chatId, ev.from, ev.payload)
            : await decryptFrom(ev.from, ev.payload as Envelope)
          applyEdit(chatId, ev.id, plain.body)
        } catch {}
        break
      }
      case 'delAll': {
        // সব ডিভাইসে একসাথে ভ্যানিশ অ্যানিমেশন
        const ids: string[] = ev.ids || []
        set((s) => ({ vanish: { ...s.vanish, ...Object.fromEntries(ids.map((i) => [i, true])) } }))
        break
      }
      case 'react': {
        applyReaction(chatId, ev.id, ev.emoji, ev.from, ev.on)
        break
      }
      case 'pins': {
        set((s) => ({ chats: s.chats[chatId] ? { ...s.chats, [chatId]: { ...s.chats[chatId], pins: ev.pins } } : s.chats }))
        break
      }
      case 'call': {
        set((s) => ({ chats: s.chats[chatId] ? { ...s.chats, [chatId]: { ...s.chats[chatId], activeCall: ev.call } } : s.chats }))
        break
      }
    }
  },

  // ── UserHub ইভেন্ট ──
  async _hub(ev) {
    const { openModal, toast } = useUi.getState()
    switch (ev.t) {
      case 'device-approval':
        openModal('device-approval', { deviceId: ev.deviceId, deviceName: ev.deviceName })
        break
      case 'device-revoked':
        toast('এই ডিভাইসের সেশন রিমোট থেকে বন্ধ করা হয়েছে')
        break
      case 'message-request':
        get().loadRequests()
        toast('নতুন মেসেজ রিকোয়েস্ট এসেছে')
        break
      case 'request-accepted':
        await get().loadChats()
        toast('আপনার রিকোয়েস্ট গৃহীত হয়েছে')
        break
      case 'chat-new':
        await get().loadChats()
        break
      case 'chat-updated':
        await get().loadChats()
        break
      case 'members-changed': {
        if (Array.isArray(ev.added) && !ev.added.includes(useAuth.getState().user?.id)) {
          await sk.markNeedsRedistribution(ev.chatId, ev.added)
        }
        await get().loadChats()
        break
      }
      case 'removed-from-chat': {
        const s = get()
        const chats = { ...s.chats }
        delete chats[ev.chatId]
        set({ chats, activeChatId: s.activeChatId === ev.chatId ? null : s.activeChatId })
        break
      }
      case 'msg': {
        // অন্য চ্যাটে নতুন মেসেজ (হাব হয়ে এসেছে)
        const c = get().chats[ev.chatId]
        if (c) set((st) => ({ chats: { ...st.chats, [ev.chatId]: { ...c, unread: c.unread + 1, lastTs: Date.now() } } }))
        if (c && !(c.mutedUntil && c.mutedUntil > Date.now())) {
          const sender = ev.from
          notifyMessage(c, { id: ev.mid, chatId: ev.chatId, senderId: sender, ts: Date.now(), type: 'text', body: 'নতুন এনক্রিপ্টেড মেসেজ', reactions: {} })
          if (useAuth.getState().settings?.sound !== false) playPing()
        }
        break
      }
    }
  },
}))

// ── হেল্পার ─────────────────────────────────────────────────
import { useUi } from './ui'

export function previewOf(m: Message): string {
  switch (m.type) {
    case 'text': return m.body || ''
    case 'image': return '📷 ছবি'
    case 'video': return '🎬 ভিডিও'
    case 'voice': return '🎤 ভয়েস মেসেজ'
    case 'file': return `📎 ${m.media?.name || 'ফাইল'}`
    case 'sticker': return '🌟 স্টিকার'
    case 'gif': return '🎞️ GIF'
    case 'call': return '📞 কল'
    default: return ''
  }
}

function appendMessage(chatId: string, msg: Message) {
  useChats.setState((s) => {
    const list = s.messages[chatId] || []
    if (list.some((m) => m.id === msg.id)) return s
    return { messages: { ...s.messages, [chatId]: [...list, msg].sort((a, b) => a.ts - b.ts) } }
  })
  // লোকাল সার্চ ইনডেক্স
  if (msg.body && msg.type !== 'sender-key') idb.put('messages', msg.id, { ...msg, payload: undefined }).catch(() => {})
}

function setReplyingPreview(chatId: string, msg: Message) {
  useChats.setState((s) => ({
    chats: { ...s.chats, [chatId]: { ...s.chats[chatId], lastPreview: previewOf(msg), lastTs: msg.ts } },
  }))
}

// রি-নেগো থ্রটল + যে মেসেজ ডিক্রিপ্ট করা যায়নি সেগুলোর তালিকা (বারবার চেষ্টা এড়াতে)
const lastRenego: Record<string, number> = {}
const failedDecryptIds = new Set<string>()

async function rowToMessage(chatId: string, row: any): Promise<Message | null> {
  try {
    let payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload
    if (row.type === 'sender-key') {
      // বন্টন করা সেন্ডার-কী ইনজেস্ট করি
      const me = useAuth.getState().user?.id
      if (row.sender_id !== me) {
        const plain = await decryptFrom(row.sender_id, payload as Envelope)
        if (plain?.sk) await sk.ingestSenderKey(plain.chatId || chatId, row.sender_id, plain.sk)
      }
      return null
    }
    if (row.type === 'call') return null
    const chat = useChats.getState().chats[chatId]
    let plain: any
    if (payload.g === 1) {
      plain = await sk.groupDecrypt(chatId, row.sender_id, payload)
    } else {
      plain = await decryptFrom(row.sender_id, payload as Envelope)
    }
    return {
      id: row.mid, chatId, senderId: row.sender_id, ts: row.ts, type: row.type,
      body: plain.body, media: plain.media, replyTo: plain.replyTo, fwdFrom: plain.fwdFrom,
      editedAt: plain.edited ? row.ts : undefined, expiresAt: plain.expiresAt,
      reactions: payload.reactions || {},
    }
  } catch (e) {
    console.warn('decrypt failed', row.mid, e)
    failedDecryptIds.add(row.mid)
    return null
  }
}

function applyEdit(chatId: string, id: string, text: string) {
  useChats.setState((s) => ({
    messages: {
      ...s.messages,
      [chatId]: (s.messages[chatId] || []).map((m) => (m.id === id ? { ...m, body: text, editedAt: Date.now() } : m)),
    },
  }))
  idb.get('messages', id).then((m) => { if (m) idb.put('messages', id, { ...m, body: text }) })
}

function applyReaction(chatId: string, id: string, emoji: string, userId: string, on: boolean) {
  useChats.setState((s) => ({
    messages: {
      ...s.messages,
      [chatId]: (s.messages[chatId] || []).map((m) => {
        if (m.id !== id) return m
        const reactions = { ...m.reactions }
        const list = reactions[emoji] || []
        reactions[emoji] = on ? [...new Set([...list, userId])] : list.filter((u) => u !== userId)
        if (!reactions[emoji].length) delete reactions[emoji]
        return { ...m, reactions }
      }),
    },
  }))
}

async function lastLocalMessage(chatId: string): Promise<Message | null> {
  const all = await idb.all<Message>('messages')
  const mine = all.filter((m) => m.chatId === chatId && m.type !== 'sender-key')
  return mine.sort((a, b) => b.ts - a.ts)[0] || null
}

function localStateFromPatch(patch: Record<string, any>): Partial<Chat> {
  const out: Partial<Chat> = {}
  if (typeof patch.pinned === 'boolean') out.pinned = patch.pinned
  if (typeof patch.archived === 'boolean') out.archived = patch.archived
  if (typeof patch.mutedUntil === 'number') out.mutedUntil = patch.mutedUntil
  if (typeof patch.wallpaper === 'string') out.wallpaper = patch.wallpaper
  if (typeof patch.ttl === 'number') out.ttl = patch.ttl
  return out
}

// ডিসঅ্যাপিয়ারিং মেসেজ টাইমার
const expiryTimers = new Map<string, any>()
function scheduleExpiry(chatId: string, msgId: string, expiresAt: number) {
  if (expiryTimers.has(msgId)) return
  const delay = Math.max(0, expiresAt - Date.now())
  expiryTimers.set(msgId, setTimeout(() => {
    expiryTimers.delete(msgId)
    useChats.getState().deleteForEveryone(chatId, [msgId])
  }, delay))
}

async function distributeSenderKeys(chatId: string, chat: Chat) {
  const me = useAuth.getState().user!.id
  const distributed = await sk.distributedSet(chatId)
  const targets = chat.members.filter((m) => m.id !== me && !m.deleted && !distributed.has(m.id))
  if (!targets.length) return
  const pkg = await sk.distributionPackage(chatId)
  for (const t of targets) {
    try {
      const env = await encryptFor(t.id, { sk: pkg, chatId })
      sendChat(chatId, {
        t: 'msg', chatId,
        m: { id: uid('sk_'), ts: Date.now(), type: 'sender-key', payload: env },
      })
      await sk.markDistributed(chatId, t.id)
    } catch (e) {
      console.warn('sender key distribution failed for', t.id, e)
    }
  }
}
