// মেসেজ বাবল — টেক্সট/মিডিয়া/স্টিকার, রিপ্লাই কোট, রিয়্যাকশন, রিসিট চেকমার্ক,
// কনটেক্সট মেনু, এবং "delete for everyone"-এর Thanos-ভ্যানিশ অ্যানিমেশন।
import React, { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { Chat, Message } from '../../types'
import { useChats } from '../../stores/chats'
import { useAuth } from '../../stores/auth'
import { useUi } from '../../stores/ui'
import { Avatar } from '../common'
import { LinkPreview } from './LinkPreview'
import { vanishElement } from '../effects/VanishEffect'
import { decryptedMediaUrl, downloadMedia } from '../../lib/media'
import { fmtTime, fmtSize, URL_RE, extractUrl, cls } from '../../lib/utils'
import { IcCheck, IcDoubleCheck, IcDownload, IcPlay, IcDoc } from '../../lib/icons'

const EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🙏', '🔥', '🎉']

export default function MessageBubble({ msg, chat, prev }: { msg: Message; chat: Chat; prev?: Message }) {
  const me = useAuth.getState().user!
  const mine = msg.senderId === me.id
  const vanishing = useChats((s) => !!s.vanish[msg.id])
  const starred = useChats((s) => !!s.starredIds[msg.id])
  const { finishVanish, toggleReaction, toggleStar, togglePinMessage, setReplying, deleteForEveryone, deleteForMe, editMessage } = useChats.getState()
  const { openMenu, openModal, toast } = useUi.getState()
  const bubbleRef = useRef<HTMLDivElement>(null)

  const isGroup = chat.kind === 'group'
  const sender = chat.members.find((m) => m.id === msg.senderId)
  const sameSender = !!prev && prev.senderId === msg.senderId && msg.ts - prev.ts < 4 * 60_000 && prev.type !== 'system'

  // ভ্যানিশ অ্যানিমেশন ট্রিগার
  useEffect(() => {
    if (vanishing && bubbleRef.current) {
      const el = bubbleRef.current
      vanishElement(el).then(() => finishVanish(chat.id, [msg.id]))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vanishing])

  function menu(e: React.MouseEvent | React.TouchEvent) {
    if ('preventDefault' in e) e.preventDefault()
    const cx = 'clientX' in e ? e.clientX : 100
    const cy = 'clientY' in e ? e.clientY : 100
    const items: any[] = [
      { label: '↩️ রিপ্লাই', onClick: () => setReplying(msg) },
      { label: '↪️ ফরওয়ার্ড', onClick: () => openModal('forward', { msg }) },
      { label: starred ? '⭐ স্টার সরাও' : '⭐ স্টার করো', onClick: () => toggleStar(msg) },
      { label: '📌 পিন/আনপিন', onClick: () => togglePinMessage(chat.id, msg.id) },
    ]
    if (msg.body) items.push({ label: '📋 কপি টেক্সট', onClick: () => { navigator.clipboard.writeText(msg.body!); toast('কপি হয়েছে') } })
    if (mine && msg.type === 'text') items.push({ label: '✏️ এডিট', onClick: () => openModal('edit', { chatId: chat.id, msg }) })
    items.push({
      label: '🗑️ ডিলিট (শুধু আমার)', danger: true,
      onClick: () => deleteForMe(chat.id, [msg.id]),
    })
    if (mine) items.push({
      label: '💨 ডিলিট ফর এভরিওয়ান', danger: true,
      onClick: () => deleteForEveryone(chat.id, [msg.id]),
    })
    if (isGroup && mine) items.push({ label: '👁️ কে দেখেছে', onClick: () => openModal('seen-by', { chatId: chat.id, msgId: msg.id }) })
    openMenu(cx, cy, items)
  }

  function quickReact(e: React.MouseEvent) {
    e.stopPropagation()
    const cx = Math.min(e.clientX, window.innerWidth - 330)
    openMenu(cx, e.clientY - 48, EMOJIS.map((em) => ({ label: em, onClick: () => toggleReaction(chat.id, msg.id, em) })))
  }

  const isMedia = ['image', 'gif'].includes(msg.type)
  const bubblePad = isMedia || msg.type === 'sticker' ? 'p-1' : 'px-3 py-2'

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 480, damping: 34 }}
      className={cls('group flex w-full px-3', mine ? 'justify-end' : 'justify-start', sameSender ? 'mt-0.5' : 'mt-2.5')}
    >
      {/* গ্রুপে অন্যের অ্যাভাটার */}
      {!mine && isGroup && (
        <div className="w-9 mr-2 self-end">
          {!sameSender && <Avatar name={sender?.username || '?'} id={msg.senderId} avatarKey={sender?.avatarKey} size={32} />}
        </div>
      )}

      <div ref={bubbleRef} onContextMenu={menu} onDoubleClick={quickReact}
        className={cls(
          'relative max-w-[78%] md:max-w-[62%] rounded-2xl shadow-sm cursor-default select-text',
          bubblePad,
          mine ? 'bg-bubble-out dark:bg-[#2b3a67] rounded-br-md' : 'bg-bubble-in dark:bg-[#1c2333] rounded-bl-md border border-slate-200/50 dark:border-slate-700/40',
          msg.type === 'sticker' && 'bg-transparent shadow-none border-none',
        )}>
        {/* সেন্ডার নাম (গ্রুপ) */}
        {!mine && isGroup && !sameSender && (
          <div className="text-[12.5px] font-semibold px-1 pt-0.5" style={{ color: senderColor(msg.senderId) }}>{sender?.username || 'Unknown'}</div>
        )}

        {/* রিপ্লাই কোট */}
        {msg.replyTo && (
          <div className="mx-1 mt-1 mb-0.5 px-2.5 py-1.5 rounded-lg border-l-[3px] border-brand-500 bg-brand-500/10 text-[12.5px]">
            <div className="font-semibold text-brand-600 dark:text-brand-300">{chat.members.find((m) => m.id === msg.replyTo!.senderId)?.username || 'Unknown'}</div>
            <div className="opacity-75 truncate max-w-[260px]">{msg.replyTo.body}</div>
          </div>
        )}

        {/* ফরওয়ার্ড লেবেল */}
        {msg.fwdFrom && <div className="text-[11.5px] italic opacity-60 px-1.5 pt-1">↪️ ফরওয়ার্ড করা</div>}

        {/* কনটেন্ট */}
        {msg.type === 'text' && <TextBody msg={msg} mine={mine} />}
        {msg.type === 'sticker' && <div className="text-[72px] leading-none px-2 py-1">{msg.body}</div>}
        {isMedia && <MediaBody msg={msg} />}
        {msg.type === 'video' && <MediaBody msg={msg} video />}
        {msg.type === 'voice' && <VoiceBody msg={msg} mine={mine} />}
        {msg.type === 'file' && <FileBody msg={msg} />}

        {/* রিয়্যাকশন */}
        {Object.keys(msg.reactions).length > 0 && (
          <div className="flex flex-wrap gap-1 px-1 pb-1 -mb-2.5">
            {Object.entries(msg.reactions).map(([em, users]) => (
              <button key={em} onClick={(e) => quickReact(e)}
                className="text-[12px] bg-white dark:bg-slate-700 shadow rounded-full px-1.5 py-0.5 border border-slate-200 dark:border-slate-600"
                title={users.map((u) => chat.members.find((m) => m.id === u)?.username || u).join(', ')}>
                {em} {users.length > 1 && <span className="opacity-70">{users.length}</span>}
              </button>
            ))}
          </div>
        )}

        {/* মেটা লাইন */}
        {msg.type !== 'sticker' && (
          <div className={cls('flex items-center gap-1 justify-end px-1.5 pb-0.5 text-[10.5px]', mine ? 'text-brand-700/60 dark:text-brand-200/50' : 'text-slate-400', (msg.reactions && Object.keys(msg.reactions).length) ? 'mt-3' : 'mt-0.5')}>
            {starred && <span>⭐</span>}
            {msg.editedAt && <span className="italic">এডিট করা</span>}
            {msg.expiresAt && <span>⏳</span>}
            <span>{fmtTime(msg.ts)}</span>
            {mine && (
              <span className={msg.read ? 'text-sky-500 dark:text-sky-400' : ''}>
                {msg.pending ? <span className="opacity-60">🕓</span> : msg.failed ? <span className="text-rose-500">!</span> : msg.read ? <IcDoubleCheck size={14} /> : msg.delivered ? <IcDoubleCheck size={14} /> : <IcCheck size={14} />}
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ── কনটেন্ট সাব-কম্পোনেন্ট ────────────────────────────────

function TextBody({ msg, mine }: { msg: Message; mine: boolean }) {
  const url = extractUrl(msg.body || '')
  const parts = (msg.body || '').split(URL_RE)
  const urls = (msg.body || '').match(URL_RE) || []
  return (
    <div className="text-[14.5px] leading-relaxed whitespace-pre-wrap break-words px-0.5 pt-0.5">
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          {p}
          {urls[i] && <a className="msg-link" href={urls[i]} target="_blank" rel="noreferrer">{urls[i]}</a>}
        </React.Fragment>
      ))}
      {url && <LinkPreview url={url} dark={mine} />}
    </div>
  )
}

function useDecrypted(media?: { key: string; fileKey?: string; iv?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let dead = false
    if (media) decryptedMediaUrl(media as any).then((u) => !dead && setUrl(u)).catch(() => !dead && setErr(true))
    return () => { dead = true }
  }, [media?.key])
  return { url, err }
}

function MediaBody({ msg, video }: { msg: Message; video?: boolean }) {
  const { url, err } = useDecrypted(msg.media)
  const { openViewer } = useUi.getState()
  return (
    <div className="relative rounded-xl overflow-hidden my-0.5 mx-0.5">
      {err && <div className="w-56 h-40 flex items-center justify-center text-sm text-slate-400 bg-slate-100 dark:bg-slate-800">মিডিয়া লোড করা যায়নি</div>}
      {url && !video && (
        <img src={url} alt="" className="max-w-[320px] max-h-[360px] object-cover cursor-zoom-in block"
          onClick={() => openViewer([url], 0, msg.media?.name)} loading="lazy" />
      )}
      {url && video && (
        <video src={url} controls className="max-w-[340px] max-h-[380px] bg-black" preload="metadata" />
      )}
      {!url && !err && (
        <div className="w-56 h-40 skeleton" />
      )}
      {url && (
        <button onClick={() => downloadMedia(msg.media!)} title="ডাউনলোড"
          className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-black/55 text-white flex items-center justify-center backdrop-blur hover:bg-black/75 transition">
          <IcDownload size={15} />
        </button>
      )}
    </div>
  )
}

function VoiceBody({ msg, mine }: { msg: Message; mine: boolean }) {
  const { url } = useDecrypted(msg.media)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const dur = msg.media?.dur || 0
  const bars = useRef(Array.from({ length: 30 }, () => 6 + Math.abs(Math.sin(msg.id.charCodeAt(2) * 7 + Math.random() * 3)) * 14)).current

  return (
    <div className="flex items-center gap-2.5 px-1.5 py-1.5 min-w-[220px]">
      <motion.button whileTap={{ scale: 0.85 }}
        onClick={() => { const a = audioRef.current; if (!a) return; playing ? a.pause() : a.play() }}
        className="w-10 h-10 rounded-full bg-brand-600 text-white flex items-center justify-center shrink-0 shadow">
        {playing ? <span className="flex gap-0.5"><i className="w-1 h-3.5 bg-white rounded" /><i className="w-1 h-3.5 bg-white rounded" /></span> : <IcPlay size={17} />}
      </motion.button>
      <div className="flex items-end gap-[2.5px] h-7">
        {bars.map((h, i) => <div key={i} className={cls('w-[3px] rounded-full', mine ? 'bg-brand-600/60' : 'bg-slate-400/70')} style={{ height: h }} />)}
      </div>
      <span className="text-[11px] opacity-60">{dur ? `${Math.floor(dur / 60)}:${String(dur % 60).padStart(2, '0')}` : ''}</span>
      {url && <audio ref={audioRef} src={url} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />}
    </div>
  )
}

function FileBody({ msg }: { msg: Message }) {
  const { url } = useDecrypted(msg.media)
  return (
    <div className="flex items-center gap-3 px-2 py-2 min-w-[230px]">
      <div className="w-11 h-11 rounded-xl bg-brand-500/15 text-brand-600 dark:text-brand-300 flex items-center justify-center shrink-0"><IcDoc size={22} /></div>
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium truncate max-w-[240px]">{msg.media?.name || 'ফাইল'}</div>
        <div className="text-[11.5px] opacity-60">{fmtSize(msg.media?.size)}</div>
      </div>
      {url && (
        <button onClick={() => downloadMedia(msg.media!)} className="ml-auto w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-600 transition">
          <IcDownload size={16} />
        </button>
      )}
    </div>
  )
}

function senderColor(id: string) {
  const colors = ['#e5484d', '#f76808', '#00a2c7', '#30a46c', '#6e56cf', '#d6409f', '#e93d82', '#12a594']
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return colors[h % colors.length]
}
