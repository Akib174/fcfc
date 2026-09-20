// সাইডবার চ্যাট লিস্ট — সার্চ, পিন/আর্কাইভ/মিউট, টাইপিং, আনরিড ব্যাজ।
import React, { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { useChats } from '../../stores/chats'
import { useAuth } from '../../stores/auth'
import { useUi } from '../../stores/ui'
import { Avatar } from '../common'
import { fmtTime, fmtDay, MUTE_OPTIONS } from '../../lib/utils'
import { chatTitle } from '../../lib/notify'
import { IcSearch, IcPencil, IcGear, IcPin, IcBellOff, IcArchive, IcCheck, IcDoubleCheck } from '../../lib/icons'
import type { Chat } from '../../types'

export default function ChatList() {
  const chats = useChats((s) => s.chats)
  const presence = useChats((s) => s.presence)
  const activeChatId = useChats((s) => s.activeChatId)
  const requests = useChats((s) => s.requests)
  const openChat = useChats((s) => s.openChat)
  const patchChatState = useChats((s) => s.patchChatState)
  const respondRequest = useChats((s) => s.respondRequest)
  const { openMenu, openModal, setPanel, toast } = useUi.getState()

  const [q, setQ] = useState('')

  const sorted = useMemo(() => {
    const needle = q.toLowerCase()
    const list = Object.values(chats).filter((c) => !c.archived)
      .filter((c) => !needle || chatTitle(c).toLowerCase().includes(needle))
    return list.sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
      return (b.lastTs || 0) - (a.lastTs || 0)
    })
  }, [chats, q])

  const archivedCount = useMemo(() => Object.values(chats).filter((c) => c.archived).length, [chats])

  function itemMenu(e: React.MouseEvent, chat: Chat) {
    e.preventDefault()
    openMenu(e.clientX, e.clientY, [
      { label: chat.pinned ? '📌 আনপিন চ্যাট' : '📌 পিন চ্যাট', onClick: () => patchChatState(chat.id, { pinned: !chat.pinned }) },
      { label: '🔕 মিউট (৮ ঘণ্টা)', onClick: () => patchChatState(chat.id, { mutedUntil: Date.now() + MUTE_OPTIONS[0].ms }) },
      { label: '🔕 মিউট (সবসময়)', onClick: () => patchChatState(chat.id, { mutedUntil: Date.now() + MUTE_OPTIONS[2].ms }) },
      { label: '🔔 আনমিউট', onClick: () => patchChatState(chat.id, { mutedUntil: 0 }) },
      { label: chat.archived ? '📤 আনআর্কাইভ' : '🗄️ আর্কাইভ', onClick: () => patchChatState(chat.id, { archived: !chat.archived }) },
      { label: '🗑️ চ্যাট ডিলিট (শুধু আমার)', danger: true, onClick: () => { patchChatState(chat.id, { deleteForMe: true }); toast('চ্যাট আপনার লিস্ট থেকে মুছে গেছে') } },
    ])
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-[#111827] border-r border-slate-200/70 dark:border-slate-800">
      {/* হেডার */}
      <div className="p-3 pb-2 flex items-center gap-2">
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => setPanel('settings')}
          className="w-10 h-10 rounded-full flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition" title="সেটিংস">
          <IcGear size={21} />
        </motion.button>
        <div className="flex-1 relative">
          <IcSearch size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && q.trim()) openModal('search', { q }) }}
            placeholder="সার্চ…"
            className="w-full pl-10 pr-4 py-2.5 rounded-full bg-slate-100 dark:bg-slate-800 text-sm focus:ring-2 focus:ring-brand-500/30 transition outline-none"
          />
        </div>
        <motion.button whileTap={{ scale: 0.9 }} onClick={() => openModal('new-chat')}
          className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 text-white flex items-center justify-center shadow-md shadow-brand-500/30" title="নতুন চ্যাট/গ্রুপ">
          <IcPencil size={18} />
        </motion.button>
      </div>

      {/* মেসেজ রিকোয়েস্ট */}
      {requests.length > 0 && (
        <button onClick={() => openModal('requests')} className="mx-3 mb-1 px-3.5 py-2.5 rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300 text-sm font-medium text-left flex items-center justify-between hover:bg-brand-500/15 transition">
          <span>📨 মেসেজ রিকোয়েস্ট</span>
          <span className="bg-brand-600 text-white text-xs rounded-full px-2 py-0.5">{requests.length}</span>
        </button>
      )}

      {archivedCount > 0 && (
        <button onClick={() => setPanel('archived')} className="mx-3 mb-1 px-3.5 py-2 rounded-xl text-slate-500 dark:text-slate-400 text-sm text-left flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
          <IcArchive size={16} /> আর্কাইভড চ্যাট <span className="text-xs opacity-60">{archivedCount}</span>
        </button>
      )}

      {/* লিস্ট */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {sorted.length === 0 && (
          <div className="text-center text-sm text-slate-400 mt-16 px-6">
            {q ? 'কোনো চ্যাট পাওয়া যায়নি' : 'এখনো কোনো চ্যাট নেই। উপরের ✏️ বাটনে ট্যাপ করে শুরু করুন।'}
          </div>
        )}
        {sorted.map((c) => (
          <ChatItem key={c.id} chat={c} active={c.id === activeChatId} presence={presence} onClick={() => openChat(c.id)} onMenu={(e) => itemMenu(e, c)} />
        ))}
      </div>
    </div>
  )
}

function ChatItem({ chat, active, presence, onClick, onMenu }: {
  chat: Chat; active: boolean; presence: Record<string, boolean>
  onClick: () => void; onMenu: (e: React.MouseEvent) => void
}) {
  const me = useAuth.getState().user?.id
  const typing = (chat.typing || []).length > 0
  const muted = !!chat.mutedUntil && chat.mutedUntil > Date.now()
  const title = chatTitle(chat)
  const online = chat.kind === 'dm' && chat.peer ? presence[chat.peer.id] : undefined
  const last = chat.lastPreview

  return (
    <motion.button
      layout
      onClick={onClick}
      onContextMenu={onMenu}
      whileTap={{ scale: 0.985 }}
      className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-2xl text-left transition-colors mb-0.5 ${
        active ? 'bg-brand-600 text-white shadow-md shadow-brand-600/20' : 'hover:bg-slate-100 dark:hover:bg-slate-800/70'
      }`}
    >
      <Avatar name={title} id={chat.id} avatarKey={chat.kind === 'group' ? chat.photoKey : chat.peer?.avatarKey} size={50} online={!active && online} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-[15px] truncate">{title}</span>
          {chat.pinned && <IcPin size={13} className={active ? 'text-white/80' : 'text-slate-400'} />}
          {muted && <IcBellOff size={13} className={active ? 'text-white/70' : 'text-slate-400'} />}
          <span className={`ml-auto text-[11px] shrink-0 ${active ? 'text-white/80' : 'text-slate-400'}`}>
            {chat.lastTs ? (Date.now() - chat.lastTs < 864e5 ? fmtTime(chat.lastTs) : fmtDay(chat.lastTs)) : ''}
          </span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className={`text-[13px] truncate ${typing ? (active ? 'text-white' : 'text-brand-500 font-medium') : active ? 'text-white/85' : 'text-slate-400'}`}>
            {typing ? 'টাইপ করছে…' : last || (chat.kind === 'group' ? chat.description?.slice(0, 60) : '')}
          </span>
          {chat.unread > 0 && (
            <span className={`ml-auto shrink-0 text-[11px] font-bold rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center ${
              muted ? 'bg-slate-300 dark:bg-slate-600 text-white' : active ? 'bg-white text-brand-700' : 'bg-brand-600 text-white'
            }`}>
              {chat.unread > 99 ? '99+' : chat.unread}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  )
}
