// মেসেজ কম্পোজার — টেক্সট, ইমোজি/স্টিকার, ফাইল/ছবি/ভিডিও (2GB পর্যন্ত),
// ভয়েস রেকর্ড, রিপ্লাই প্রিভিউ, টাইপিং ইন্ডিকেটর, ডিসঅ্যাপিয়ারিং মোড।
import React, { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Chat } from '../../types'
import { useChats } from '../../stores/chats'
import { useUi } from '../../stores/ui'
import { useRecorder } from '../../hooks/useRecorder'
import { uploadEncrypted } from '../../lib/media'
import { makeThumb } from '../../crypto/files'
import { cls, debounce } from '../../lib/utils'
import { IcSmile, IcClip, IcMic, IcSend, IcX, IcImage, IcDoc, IcTimer, IcCamera } from '../../lib/icons'

const EMOJIS = ('😀 😁 😂 🤣 😊 😍 🥰 😘 😎 🤩 🥳 😅 😉 🙃 😇 🙂 😌 😋 🤤 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 😐 😑 😶 🙄 😏 😣 😥 😮 🤐 😯 😪 😫 🥱 😴 😌 😛 😜 😝 😒 😓 😔 😕 🙁 😞 😤 😢 😭 😦 😧 😨 😩 🤯 😬 😰 😱 🥵 🥶 😳 🤪 😵 🥴 😠 😡 🤬 🤒 🤕 🤢 🤮 🥺 😷 🤧 💀 👻 👽 🤖 💩 😺 🙈 🙉 🙊 💋 💌 💘 💝 💖 💗 💓 💞 💕 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❣️ 💯 💢 💥 💫 💦 💨 🕳️ 👋 🤚 ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 👐 🤲 🤝 🙏 ✍️ 💪 🔥 ⭐ ✨ 🌈 ☀️ 🌙 ⚡ ❄️ 🎉 🎊 🎁 🎂 🍰 🍕 🍔 🍟 🌮 ☕ 🍵 🥤 ⚽ 🏀 🏆 🎮 🎵 🎶 🎤 🎧 📸 📱 💻 ⌚ 🔒 🔑 💡 📌 📎 ✅ ❌ ⚠️ ❓ ❗').split(' ')

const STICKERS = ['🐱 😺 😸 😹 😻 😼 😽 🙀 😿 😾 🦁 🐯 🐶 🐺 🦊 🐻 🐼 🐨 🐹 🐰 🦄 🐝 🦋 🐢 🐬 🐳 🦖 🌸 🌺 🌻 🌵 🌲 🍀 🍁 🍄 🌙 ⭐ 💫 ✨ 🎈 🎉 🎊 🎂 🍭 🍩 🍪 🧁 🍫 ☕ 🧋 🥤 🍜 🍣 🍕 🍔 🍟 🌶️ 🥑 ⚡ 🌈 🔥 💧 ❄️ 🎮 🎲 🎯 🎸 🥁 🎻 🚀 ✈️ 🚗 ⚽ 🏀 🏆 💪 👑 💎 🧿 🎁 💌'.split(' ')]

export default function Composer({ chat }: { chat: Chat }) {
  const [text, setText] = useState('')
  const [pop, setPop] = useState<null | 'emoji' | 'sticker' | 'attach'>(null)
  const [uploading, setUploading] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const rec = useRecorder()
  const { sendDraft, setTyping, replyingTo, setReplying, editMessage } = useChats.getState()
  const toast = useUi((s) => s.toast)

  const editing = useUi((s) => s.modal?.type === 'edit' && s.modal.props?.chatId === chat.id ? s.modal.props.msg : null)

  // টাইপিং ইভেন্ট (থ্রটলড)
  const typingOn = useRef(debounce(() => setTyping(true), 150))
  const typingOff = useRef(debounce(() => setTyping(false), 2200))
  useEffect(() => () => setTyping(false), [])

  function onChange(v: string) {
    setText(v)
    typingOn.current()
    typingOff.current()
    const ta = taRef.current
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px' }
  }

  async function send() {
    const body = text.trim()
    if (!body) return
    setText('')
    if (taRef.current) taRef.current.style.height = 'auto'
    setTyping(false)
    await sendDraft(chat.id, { type: 'text', body, replyTo: replyingTo ? { id: replyingTo.id, body: replyingTo.body?.slice(0, 120) || `(${replyingTo.type})`, senderId: replyingTo.senderId } : undefined, ttl: chat.ttl })
  }

  async function pickFile(kind: 'media' | 'file') {
    setPop(null)
    fileRef.current?.setAttribute('data-kind', kind)
    fileRef.current?.click()
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 2 * 1024 * 1024 * 1024) { toast('সর্বোচ্চ 2GB ফাইল পাঠানো যাবে'); return }
    setUploading(true)
    try {
      const kind = fileRef.current?.getAttribute('data-kind')
      const isImg = file.type.startsWith('image/')
      const isVid = file.type.startsWith('video/')
      const meta = await uploadEncrypted(file, file.name, file.type || 'application/octet-stream')
      if (isImg) {
        const img = await new Promise<HTMLImageElement | null>((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = URL.createObjectURL(file) })
        if (img) { meta.w = img.naturalWidth; meta.h = img.naturalHeight }
      }
      const type = isImg ? 'image' : isVid ? 'video' : kind === 'media' ? (isVid ? 'video' : 'image') : 'file'
      await sendDraft(chat.id, { type: type as any, media: meta, ttl: chat.ttl })
    } catch (err: any) {
      toast('আপলোড ব্যর্থ: ' + (err.message || ''))
    } finally {
      setUploading(false)
    }
  }

  async function finishRecording(discard: boolean) {
    const blob = await rec.stop()
    if (discard || !blob) return
    const meta = await uploadEncrypted(blob, `voice-${Date.now()}.webm`, blob.type)
    meta.dur = rec.seconds
    await sendDraft(chat.id, { type: 'voice', media: meta, ttl: chat.ttl })
  }

  return (
    <div className="relative px-2 pb-2 pt-1">
      {/* রিপ্লাই প্রিভিউ */}
      <AnimatePresence>
        {replyingTo && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden mx-1 mb-1">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-brand-500/10 border-l-4 border-brand-500">
              <div className="flex-1 min-w-0 text-[13px]">
                <div className="font-semibold text-brand-600 dark:text-brand-300">রিপ্লাই</div>
                <div className="truncate opacity-75">{replyingTo.body || `(${replyingTo.type})`}</div>
              </div>
              <button onClick={() => setReplying(null)} className="opacity-60 hover:opacity-100"><IcX size={16} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* রেকর্ডিং ব্যানার */}
      {rec.recording ? (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
          <span className="text-sm font-medium">{Math.floor(rec.seconds / 60)}:{String(rec.seconds % 60).padStart(2, '0')}</span>
          <span className="text-xs opacity-50">রেকর্ড হচ্ছে…</span>
          <div className="ml-auto flex gap-2">
            <button onClick={() => { rec.cancel() }} className="px-3 py-1.5 rounded-xl text-sm bg-slate-100 dark:bg-slate-700">বাতিল</button>
            <button onClick={() => finishRecording(false)} className="px-4 py-1.5 rounded-xl text-sm bg-brand-600 text-white font-medium">পাঠান</button>
          </div>
        </motion.div>
      ) : (
        <div className="flex items-end gap-1.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm px-2 py-1.5">
          <input ref={fileRef} type="file" className="hidden" onChange={onFile} />

          {/* ইমোজি / স্টিকার */}
          <button onClick={() => setPop(pop === 'emoji' ? null : 'emoji')} className={cls('p-2 rounded-xl transition', pop === 'emoji' ? 'text-brand-600 bg-brand-500/10' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200')}>
            <IcSmile size={22} />
          </button>

          <textarea
            ref={taRef}
            rows={1}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder="মেসেজ লিখুন…"
            className="flex-1 resize-none bg-transparent px-1 py-2 text-[14.5px] leading-snug max-h-[140px] placeholder:text-slate-400"
          />

          {chat.ttl ? <span className="text-brand-500 self-center mr-1" title="ডিসঅ্যাপিয়ারিং মোড চালু"><IcTimer size={17} /></span> : null}

          {text.trim() ? (
            <motion.button whileTap={{ scale: 0.85 }} onClick={send}
              className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-500 to-violet-600 text-white flex items-center justify-center shadow-md shadow-brand-500/30 shrink-0">
              <IcSend size={18} />
            </motion.button>
          ) : (
            <>
              <button onClick={() => setPop(pop === 'attach' ? null : 'attach')} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition">
                <IcClip size={22} />
              </button>
              <motion.button whileTap={{ scale: 0.85 }} onClick={async () => { const ok = await rec.start(); if (!ok) toast('মাইক অ্যাক্সেস দেওয়া হয়নি') }}
                className="w-10 h-10 rounded-full bg-brand-600 text-white flex items-center justify-center shadow-md shadow-brand-500/30 shrink-0">
                <IcMic size={19} />
              </motion.button>
            </>
          )}
        </div>
      )}

      {/* পপওভার */}
      <AnimatePresence>
        {pop && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}
            className="absolute bottom-full left-2 right-2 mb-2 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden z-20"
          >
            {pop === 'emoji' && (
              <div>
                <div className="grid grid-cols-8 gap-0.5 p-3 max-h-56 overflow-y-auto text-[22px]">
                  {EMOJIS.map((e) => (
                    <button key={e} onClick={() => { setText((t) => t + e); taRef.current?.focus() }} className="hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg p-1">{e}</button>
                  ))}
                </div>
                <div className="border-t border-slate-100 dark:border-slate-700 px-3 py-2 flex items-center justify-between">
                  <span className="text-xs text-slate-400">স্টিকার পাঠাতে:</span>
                  <button onClick={() => setPop('sticker')} className="text-xs font-semibold text-brand-600 dark:text-brand-300">🌟 স্টিকার</button>
                </div>
              </div>
            )}
            {pop === 'sticker' && (
              <div className="grid grid-cols-5 gap-1 p-3 max-h-64 overflow-y-auto">
                {STICKERS[0].map((s) => (
                  <button key={s} onClick={async () => { setPop(null); await sendDraft(chat.id, { type: 'sticker', body: s }) }}
                    className="text-[40px] hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl p-2">{s}</button>
                ))}
              </div>
            )}
            {pop === 'attach' && (
              <div className="p-2 grid grid-cols-3 gap-2">
                {[
                  { icon: <IcImage size={22} />, label: 'ছবি', fn: () => pickFile('media'), accept: 'image/*' },
                  { icon: <IcCamera size={22} />, label: 'ভিডিও', fn: () => pickFile('media'), accept: 'video/*' },
                  { icon: <IcDoc size={22} />, label: 'ফাইল (2GB)', fn: () => pickFile('file'), accept: '*/*' },
                ].map((a) => (
                  <button key={a.label} onClick={a.fn}
                    className="flex flex-col items-center gap-1.5 py-4 rounded-xl hover:bg-brand-500/10 text-slate-600 dark:text-slate-300 transition">
                    <span className="text-brand-500">{a.icon}</span>
                    <span className="text-xs font-medium">{a.label}</span>
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {uploading && (
        <div className="absolute inset-x-4 top-0 h-1 rounded-full overflow-hidden bg-brand-500/20">
          <motion.div className="h-full bg-brand-500" animate={{ x: ['-100%', '100%'] }} transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }} style={{ width: '40%' }} />
        </div>
      )}
    </div>
  )
}
