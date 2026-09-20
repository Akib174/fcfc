// চ্যাট উইন্ডো — হেডার, পিনড বার, মেসেজ লিস্ট (ডেট-সেপারেটর সহ), টাইপিং।
import React, { useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useChats } from '../../stores/chats'
import { useAuth } from '../../stores/auth'
import { useUi } from '../../stores/ui'
import { Avatar } from '../common'
import MessageBubble from './MessageBubble'
import Composer from './Composer'
import { chatTitle, } from '../../lib/notify'
import { fmtDay, fmtLastSeen, MUTE_OPTIONS } from '../../lib/utils'
import { IcBack, IcPhone, IcVideo, IcSearch, IcMore, IcPin, IcX, IcBellOff, IcExport, IcWallpaper, IcTrash, IcTimer, IcUsers } from '../../lib/icons'
import type { Message } from '../../types'

export default function ChatWindow({ chatId }: { chatId: string }) {
  const chat = useChats((s) => s.chats[chatId])
  const messages = useChats((s) => s.messages[chatId] || [])
  const presence = useChats((s) => s.presence)
  const { closeChat, loadHistory, markRead, patchChatState, togglePinMessage } = useChats.getState()
  const { openMenu, openModal, toast, setMobileView } = useUi.getState()
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastCount = useRef(0)

  useEffect(() => {
    // নতুন মেসেজে স্ক্রল
    if (messages.length !== lastCount.current) {
      lastCount.current = messages.length
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: messages.length > 40 ? 'auto' : 'smooth' }))
    }
  }, [messages.length])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      if (el.scrollTop < 300 && !useChats.getState().loadedAll[chatId]) {
        const first = useChats.getState().messages[chatId]?.[0]
        if (first) loadHistory(chatId, first.ts)
      }
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [chatId])

  // ভিজিবিলিটি: ফোকাসে এলে রিড-রিচিট
  useEffect(() => {
    const vis = () => { if (document.visibilityState === 'visible') markRead(chatId) }
    document.addEventListener('visibilitychange', vis)
    return () => document.removeEventListener('visibilitychange', vis)
  }, [chatId])

  const days = useMemo(() => {
    const out: (Message | { day: string; id: string })[] = []
    let lastDay = ''
    for (const m of messages) {
      const d = new Date(m.ts).toDateString()
      if (d !== lastDay) { lastDay = d; out.push({ day: fmtDay(m.ts), id: 'day-' + d }) }
      out.push(m)
    }
    return out
  }, [messages])

  if (!chat) return null
  const title = chatTitle(chat)
  const typing = (chat.typing || []).map((u) => chat.members.find((m) => m.id === u)?.username || 'কেউ')
  const online = chat.kind === 'dm' && chat.peer ? presence[chat.peer.id] : false
  const subtitle = typing.length
    ? `${typing.join(', ')} টাইপ করছে…`
    : chat.kind === 'group'
      ? `${chat.members.length} জন মেম্বার`
      : online ? 'অনলাইন'
      : chat.peer?.deleted ? 'অ্যাকাউন্ট ডিলিট করা হয়েছে'
      : chat.peer?.lastSeenPriv === 'nobody' ? 'শেষ দেখা লুকানো'
      : `শেষ দেখা: ${fmtLastSeen(chat.peer?.lastSeenAt)}`

  const pinnedMsgs = (chat.pins || []).map((id) => messages.find((m) => m.id === id)).filter(Boolean) as Message[]

  function headerMenu(e: React.MouseEvent) {
    openMenu(e.clientX, e.clientY, [
      { label: '🔍 এই চ্যাটে সার্চ', onClick: () => openModal('search', { chatId }) },
      { label: '🖼️ ওয়ালপেপার বদলান', onClick: () => openModal('wallpaper', { chatId }) },
      { label: chat.mutedUntil && chat.mutedUntil > Date.now() ? '🔔 আনমিউট' : '🔕 মিউট ৮ ঘণ্টা', onClick: () => patchChatState(chatId, { mutedUntil: chat.mutedUntil && chat.mutedUntil > Date.now() ? 0 : Date.now() + MUTE_OPTIONS[0].ms }) },
      { label: chat.ttl ? '⏳ ডিসঅ্যাপিয়ারিং বন্ধ' : '⏳ ডিসঅ্যাপিয়ারিং (২৪ ঘণ্টা)', onClick: () => patchChatState(chatId, { ttl: chat.ttl ? 0 : 86400 }) },
      { label: '📤 চ্যাট এক্সপোর্ট', onClick: () => useChats.getState().exportChat(chatId) },
      chat.kind === 'group'
        ? { label: 'ℹ️ গ্রুপ ইনফো', onClick: () => openModal('group-info', { chatId }) }
        : { label: '👤 প্রোফাইল দেখুন', onClick: () => openModal('profile', { userId: chat.peer?.id }) },
      ...(chat.kind === 'dm' ? [{ label: '🗑️ চ্যাট ডিলিট (আমার)', danger: true, onClick: () => { patchChatState(chatId, { deleteForMe: true }); closeChat(); toast('চ্যাট মুছে ফেলা হয়েছে') } }] : []),
    ])
  }

  return (
    <div className="h-full flex flex-col relative chat-bg wallpaper-cover" style={chat.wallpaper ? { backgroundImage: `url(${chat.wallpaper})` } : undefined}>
      {/* হেডার */}
      <div className="flex items-center gap-2.5 px-3 py-2 bg-white/90 dark:bg-slate-900/90 backdrop-blur border-b border-slate-200/60 dark:border-slate-800 z-10">
        <button onClick={() => { setMobileView('list'); closeChat() }} className="md:hidden p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"><IcBack size={20} /></button>
        <button className="flex items-center gap-3 flex-1 min-w-0 text-left" onClick={() => openModal(chat.kind === 'group' ? 'group-info' : 'profile', chat.kind === 'group' ? { chatId } : { userId: chat.peer?.id })}>
          <Avatar name={title} id={chatId} avatarKey={chat.kind === 'group' ? chat.photoKey : chat.peer?.avatarKey} size={42} online={!!online} />
          <div className="min-w-0">
            <div className="font-semibold text-[15px] truncate">{title}</div>
            <div className={`text-xs truncate ${typing.length ? 'text-brand-500 font-medium' : 'text-slate-400'}`}>{subtitle}</div>
          </div>
        </button>

        {/* চলমান কল ব্যানার */}
        <AnimatePresence>
          {chat.activeCall && (
            <motion.button initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
              onClick={() => useUi.getState().setCall({ chatId, mode: 'video' })}
              className="px-3 py-1.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> কল চলছে — জয়েন
            </motion.button>
          )}
        </AnimatePresence>

        <button onClick={() => useUi.getState().setCall({ chatId, mode: 'audio' })} className="p-2 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"><IcPhone size={20} /></button>
        <button onClick={() => useUi.getState().setCall({ chatId, mode: 'video' })} className="p-2 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"><IcVideo size={21} /></button>
        <button onClick={() => openModal('search', { chatId })} className="p-2 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition hidden sm:block"><IcSearch size={19} /></button>
        <button onClick={headerMenu} className="p-2 rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"><IcMore size={20} /></button>
      </div>

      {/* পিনড মেসেজ বার */}
      <AnimatePresence>
        {pinnedMsgs.length > 0 && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            className="overflow-hidden bg-white/80 dark:bg-slate-900/80 backdrop-blur border-b border-slate-200/50 dark:border-slate-800 z-10">
            <div className="flex items-center gap-2.5 px-4 py-2">
              <IcPin size={16} className="text-brand-500 shrink-0" />
              <div className="flex-1 min-w-0 text-[13px]">
                <span className="font-semibold text-brand-600 dark:text-brand-300">পিন করা</span>
                <span className="opacity-70 truncate ml-2">{pinnedMsgs[pinnedMsgs.length - 1]?.body || `(${pinnedMsgs.length}টি মেসেজ)`}</span>
              </div>
              {pinnedMsgs.length > 1 && <span className="text-xs opacity-50">১/{pinnedMsgs.length}</span>}
              <button onClick={() => togglePinMessage(chatId, pinnedMsgs[pinnedMsgs.length - 1].id)} className="opacity-50 hover:opacity-100"><IcX size={16} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* মেসেজ লিস্ট */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain py-3">
        {messages.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <div className="px-5 py-3 rounded-2xl bg-black/25 dark:bg-black/40 text-white/90 text-sm backdrop-blur text-center">
              🔒 এই চ্যাট এন্ড-টু-এন্ড এনক্রিপ্টেড। প্রথম মেসেজ পাঠিয়ে শুরু করুন।
            </div>
          </div>
        )}
        {days.map((item) =>
          'day' in item ? (
            <div key={item.id} className="flex justify-center my-3">
              <span className="px-3 py-1 rounded-full bg-black/20 dark:bg-black/40 text-white/90 text-xs font-medium backdrop-blur">{item.day}</span>
            </div>
          ) : (
            <MessageBubble key={item.id} msg={item} chat={chat} prev={messages[messages.indexOf(item) - 1]} />
          ),
        )}
        <AnimatePresence>
          {typing.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex px-3 mt-2">
              <div className="bg-bubble-in dark:bg-[#1c2333] rounded-2xl rounded-bl-md px-4 py-3 shadow-sm border border-slate-200/50 dark:border-slate-700/40 flex gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.span key={i} className="w-1.5 h-1.5 rounded-full bg-slate-400"
                    animate={{ y: [0, -4, 0] }} transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.15 }} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={bottomRef} />
      </div>

      <Composer chat={chat} />
    </div>
  )
}
