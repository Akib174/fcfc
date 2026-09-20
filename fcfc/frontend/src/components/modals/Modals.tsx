// সব মডাল এক ফাইলে — বেস মডাল + সার্চ, নতুন চ্যাট/গ্রুপ, গ্রুপ ইনফো,
// প্রোফাইল, ফরওয়ার্ড, এডিট, ডিভাইস-অ্যাপ্রুভাল, রিকোয়েস্ট, ওয়ালপেপার, ছবি ভিউয়ার।
import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useUi } from '../../stores/ui'
import { useAuth } from '../../stores/auth'
import { useChats } from '../../stores/chats'
import { api } from '../../api/client'
import { wallpaperDataUrl } from '../../lib/media'
import { Avatar, Spinner } from '../common'
import { debounce } from '../../lib/utils'
import { IcSearch, IcX, IcUsers, IcDownload, IcTrash, IcCopy, IcCheck } from '../../lib/icons'

export default function Modals() {
  const modal = useUi((s) => s.modal)
  const viewer = useUi((s) => s.viewer)
  const closeModal = useUi((s) => s.closeModal)
  const closeViewer = useUi((s) => s.closeViewer)

  return (
    <>
      <AnimatePresence>
        {modal && (
          <ModalShell onClose={closeModal} wide={modal.type === 'search'}>
            {modal.type === 'search' && <SearchModal chatId={modal.props?.chatId} q0={modal.props?.q || ''} />}
            {modal.type === 'new-chat' && <NewChatModal />}
            {modal.type === 'group-info' && <GroupInfo chatId={modal.props.chatId} />}
            {modal.type === 'profile' && <ProfileModal userId={modal.props.userId} />}
            {modal.type === 'forward' && <ForwardModal msg={modal.props.msg} />}
            {modal.type === 'edit' && <EditModal chatId={modal.props.chatId} msg={modal.props.msg} />}
            {modal.type === 'device-approval' && <DeviceApproval {...modal.props} />}
            {modal.type === 'requests' && <RequestsModal />}
            {modal.type === 'seen-by' && <SeenBy chatId={modal.props.chatId} msgId={modal.props.msgId} />}
            {modal.type === 'wallpaper' && <WallpaperModal chatId={modal.props.chatId} />}
            {modal.type === 'confirm' && <ConfirmModal {...modal.props} />}
          </ModalShell>
        )}
        {viewer && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[85] bg-black/92 flex items-center justify-center" onClick={closeViewer}>
            <motion.img key={viewer.index} initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              src={viewer.urls[viewer.index]} className="max-w-[92vw] max-h-[88vh] object-contain rounded-lg" onClick={(e) => e.stopPropagation()} />
            <button className="absolute top-4 right-4 text-white/80 hover:text-white"><IcX size={26} /></button>
            {viewer.urls.length > 1 && (
              <div className="absolute bottom-6 flex gap-2">
                {viewer.urls.map((_, i) => (
                  <button key={i} onClick={(e) => { e.stopPropagation(); useUi.getState().openViewer(viewer.urls, i) }}
                    className={`w-2.5 h-2.5 rounded-full ${i === viewer.index ? 'bg-white' : 'bg-white/30'}`} />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

export function ModalShell({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 14 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? 'max-w-xl' : 'max-w-md'} max-h-[85vh] overflow-hidden rounded-3xl bg-white dark:bg-slate-900 shadow-2xl flex flex-col`}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}

export function ModalHeader({ title, onClose, icon }: { title: string; onClose?: () => void; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-100 dark:border-slate-800">
      {icon}{<h3 className="font-bold text-lg flex-1">{title}</h3>}
      <button onClick={onClose || useUi.getState().closeModal} className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 opacity-60"><IcX size={18} /></button>
    </div>
  )
}

// ── সার্চ (গ্লোবাল ইউজার + লোকাল মেসেজ) ──
function SearchModal({ chatId, q0 }: { chatId?: string; q0?: string }) {
  const [q, setQ] = useState(q0)
  const [users, setUsers] = useState<any[]>([])
  const [msgs, setMsgs] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const closeModal = useUi((s) => s.closeModal)
  const chats = useChats((s) => s.chats)

  const doSearch = useMemo(() => debounce(async (qq: string) => {
    if (qq.trim().length < 2) { setUsers([]); setMsgs([]); return }
    setBusy(true)
    try {
      const [u, m] = await Promise.all([
        api(`/users/search?q=${encodeURIComponent(qq)}`),
        useChats.getState().localSearch(qq),
      ])
      setUsers(u.results || [])
      setMsgs(chatId ? m.filter((x) => x.chatId === chatId) : m)
    } finally { setBusy(false) }
  }, 350), [chatId])

  useEffect(() => { doSearch(q) }, [q])

  return (
    <>
      <div className="px-4 pt-4 pb-2">
        <div className="relative">
          <IcSearch size={17} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="ইউজারনেম বা মেসেজ সার্চ করুন…"
            className="w-full pl-11 pr-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-[15px] focus:ring-2 focus:ring-brand-500/30 outline-none" />
        </div>
      </div>
      <div className="overflow-y-auto px-2 pb-3">
        {busy && <div className="p-6 flex justify-center"><Spinner /></div>}
        {!busy && users.length > 0 && (
          <>
            <div className="px-3 pt-2 pb-1 text-xs font-semibold text-slate-400 uppercase">ইউজার</div>
            {users.map((u) => (
              <button key={u.id} onClick={async () => { closeModal(); const { chatId } = await useChats.getState().createDm(u.id); if (chatId) useChats.getState().openChat(chatId) }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left">
                <Avatar name={u.username} id={u.id} avatarKey={u.avatarKey} size={44} />
                <div className="min-w-0">
                  <div className="font-semibold">{u.username}</div>
                  {u.about && <div className="text-xs text-slate-400 truncate">{u.about}</div>}
                </div>
              </button>
            ))}
          </>
        )}
        {!busy && msgs.length > 0 && (
          <>
            <div className="px-3 pt-3 pb-1 text-xs font-semibold text-slate-400 uppercase">মেসেজ</div>
            {msgs.slice(0, 40).map((m) => {
              const c = chats[m.chatId]
              return (
                <button key={m.id} onClick={() => { closeModal(); useChats.getState().openChat(m.chatId) }}
                  className="w-full px-3 py-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800 text-left">
                  <div className="text-xs font-semibold text-brand-500">{c?.title || c?.peer?.username || 'চ্যাট'}</div>
                  <div className="text-sm truncate mt-0.5">{m.body}</div>
                </button>
              )
            })}
          </>
        )}
        {!busy && q.length >= 2 && !users.length && !msgs.length && (
          <div className="text-center text-sm text-slate-400 py-8">কিছু পাওয়া যায়নি</div>
        )}
      </div>
    </>
  )
}

// ── নতুন চ্যাট / গ্রুপ ──
function NewChatModal() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [tab, setTab] = useState<'dm' | 'group'>('dm')
  const [members, setMembers] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [limit, setLimit] = useState(200)
  const [joinCode, setJoinCode] = useState('')
  const closeModal = useUi((s) => s.closeModal)
  const toast = useUi((s) => s.toast)

  const doSearch = useMemo(() => debounce(async (qq: string) => {
    if (qq.trim().length < 2) return setResults([])
    const r = await api(`/users/search?q=${encodeURIComponent(qq)}`)
    setResults(r.results || [])
  }, 350), [])
  useEffect(() => { doSearch(q) }, [q])

  return (
    <>
      <ModalHeader title="নতুন চ্যাট" />
      <div className="px-5 pt-3 flex gap-2">
        <button onClick={() => setTab('dm')} className={`px-4 py-1.5 rounded-full text-sm font-semibold ${tab === 'dm' ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>১:১ চ্যাট</button>
        <button onClick={() => setTab('group')} className={`px-4 py-1.5 rounded-full text-sm font-semibold ${tab === 'group' ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>নতুন গ্রুপ</button>
      </div>

      <div className="p-4 space-y-3 overflow-y-auto">
        {tab === 'dm' && (
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ইউজারনেম সার্চ করুন…"
              className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-brand-500/30" />
            {results.map((u) => (
              <button key={u.id} onClick={async () => {
                const res = await useChats.getState().createDm(u.id)
                closeModal()
                if (res.request) toast('মেসেজ রিকোয়েস্ট পাঠানো হয়েছে — গ্রহণ করলে চ্যাট খুলবে')
                else if (res.chatId) useChats.getState().openChat(res.chatId)
              }} className="w-full flex items-center gap-3 px-2 py-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800">
                <Avatar name={u.username} id={u.id} avatarKey={u.avatarKey} size={42} />
                <div className="text-left"><div className="font-semibold text-sm">{u.username}</div><div className="text-xs text-slate-400 truncate max-w-[220px]">{u.about}</div></div>
              </button>
            ))}
          </>
        )}
        {tab === 'group' && (
          <>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="গ্রুপের নাম"
              className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-brand-500/30" />
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="বর্ণনা (ঐচ্ছিক)"
              className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-brand-500/30" />
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-400">মেম্বার লিমিট:</span>
              <input type="number" min={2} max={1000} value={limit} onChange={(e) => setLimit(parseInt(e.target.value) || 200)}
                className="w-24 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 outline-none" />
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="মেম্বার যোগ করতে সার্চ করুন…"
              className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-brand-500/30" />
            {results.map((u) => (
              <button key={u.id} onClick={() => setMembers((m) => m.includes(u.id) ? m.filter((x) => x !== u.id) : [...m, u.id])}
                className={`w-full flex items-center gap-3 px-2 py-2 rounded-2xl transition ${members.includes(u.id) ? 'bg-brand-500/15' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                <Avatar name={u.username} id={u.id} avatarKey={u.avatarKey} size={40} />
                <span className="font-medium text-sm">{u.username}</span>
                {members.includes(u.id) && <span className="ml-auto text-brand-500"><IcCheck size={18} /></span>}
              </button>
            ))}
            <button
              disabled={!title.trim()}
              onClick={async () => {
                const id = await useChats.getState().createGroup(title, desc, members, limit)
                closeModal()
                useChats.getState().openChat(id)
              }}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-brand-600 to-violet-600 text-white font-semibold disabled:opacity-40">
              গ্রুপ তৈরি করুন {members.length > 0 && `(${members.length} জন মেম্বার)`}
            </button>
          </>
        )}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="text-xs font-semibold text-slate-400 uppercase mb-1.5">অথবা ইনভাইট লিংকে জয়েন</div>
          <div className="flex gap-2">
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="লিংক কোড…"
              className="flex-1 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none" />
            <button onClick={async () => {
              try { const id = await useChats.getState().joinInvite(joinCode.trim().split('/').pop() || ''); closeModal(); useChats.getState().openChat(id) }
              catch (e: any) { toast(e.message || 'লিংকটি সঠিক নয়') }
            }} className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold">জয়েন</button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── গ্রুপ ইনফো ──
function GroupInfo({ chatId }: { chatId: string }) {
  const chat = useChats((s) => s.chats[chatId])
  const me = useAuth.getState().user!
  const [invites, setInvites] = useState<any[]>([])
  const closeModal = useUi((s) => s.closeModal)
  const toast = useUi((s) => s.toast)
  if (!chat) return null
  const myRole = chat.members.find((m) => m.id === me.id)?.role || 'member'
  const isAdmin = myRole === 'owner' || myRole === 'admin'

  async function loadInvites() {
    if (!isAdmin) return
    try { const r = await api(`/chats/${chatId}/invites`); setInvites(r.invites || []) } catch {}
  }
  useEffect(() => { loadInvites() }, [])

  return (
    <>
      <ModalHeader title="গ্রুপ ইনফো" />
      <div className="p-5 overflow-y-auto space-y-4">
        <div className="flex items-center gap-4">
          <Avatar name={chat.title} id={chatId} avatarKey={chat.photoKey} size={64} />
          <div>
            <div className="text-lg font-bold">{chat.title}</div>
            <div className="text-sm text-slate-400">{chat.members.length} জন মেম্বার · লিমিট {chat.memberLimit || 200}</div>
          </div>
        </div>
        {chat.description && <p className="text-sm bg-slate-50 dark:bg-slate-800 rounded-xl p-3">{chat.description}</p>}

        <div>
          <div className="text-xs font-semibold text-slate-400 uppercase mb-2">মেম্বার</div>
          {chat.members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 py-1.5">
              <Avatar name={m.username} id={m.id} avatarKey={m.avatarKey} size={36} />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{m.username}</span>
                {m.role !== 'member' && <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-brand-500/15 text-brand-600 dark:text-brand-300">{m.role === 'owner' ? 'মালিক' : 'অ্যাডমিন'}</span>}
              </div>
              {isAdmin && m.id !== me.id && (
                <div className="flex gap-1">
                  {myRole === 'owner' && (
                    <button onClick={async () => { await api(`/chats/${chatId}/admin`, { body: { userId: m.id, admin: m.role === 'member' } }); useChats.getState().loadChats() }}
                      className="text-xs px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800">{m.role === 'member' ? 'অ্যাডমিন করুন' : 'অ্যাডমিন সরাও'}</button>
                  )}
                  {(myRole === 'owner' || m.role === 'member') && (
                    <button onClick={async () => { await api(`/chats/${chatId}/members/${m.id}`, { method: 'DELETE' }); useChats.getState().loadChats() }}
                      className="text-xs px-2 py-1 rounded-lg bg-rose-500/10 text-rose-500">রিমুভ</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {isAdmin && (
          <div>
            <div className="text-xs font-semibold text-slate-400 uppercase mb-2">ইনভাইট লিংক</div>
            <button onClick={async () => {
              const r = await api(`/chats/${chatId}/invites`)
              const link = `${location.origin}/#/join/${r.code}`
              await navigator.clipboard.writeText(link).catch(() => {})
              toast('ইনভাইট লিংক কপি হয়েছে: ' + link)
              loadInvites()
            }} className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold">নতুন ইনভাইট লিংক তৈরি</button>
            {invites.map((inv) => (
              <div key={inv.code} className="flex items-center gap-2 mt-2 text-sm">
                <code className="flex-1 truncate bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-1.5">{location.origin}/#/join/{inv.code}</code>
                <button onClick={() => navigator.clipboard.writeText(`${location.origin}/#/join/${inv.code}`)} className="p-1.5 opacity-60 hover:opacity-100"><IcCopy size={15} /></button>
                <button onClick={async () => { await api(`/invites/${inv.code}`, { method: 'DELETE' }); loadInvites() }} className="p-1.5 text-rose-500"><IcTrash size={15} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

// ── ইউজার প্রোফাইল ──
function ProfileModal({ userId }: { userId: string }) {
  const [u, setU] = useState<any>(null)
  const [blocked, setBlocked] = useState(false)
  const toast = useUi((s) => s.toast)
  useEffect(() => { api(`/users/${userId}`).then((r) => setU(r.user)).catch(() => {}) }, [userId])
  useEffect(() => {
    api('/me/blocked').then((r) => setBlocked(r.results.some((b: any) => b.id === userId))).catch(() => {})
  }, [userId])
  if (!u) return <div className="p-8 flex justify-center"><Spinner /></div>
  return (
    <>
      <ModalHeader title="প্রোফাইল" />
      <div className="p-6 flex flex-col items-center gap-3">
        <Avatar name={u.username} id={u.id} avatarKey={u.avatarKey} size={90} />
        <div className="text-xl font-bold">@{u.username}</div>
        {u.about && <div className="text-sm text-slate-400 text-center max-w-xs">{u.about}</div>}
        {u.deleted && <div className="text-sm text-rose-500">এই ইউজার অ্যাকাউন্ট ডিলিট করেছেন</div>}
        <div className="flex gap-2 mt-3">
          <button onClick={async () => { const res = await useChats.getState().createDm(u.id); useUi.getState().closeModal(); if (res.chatId) useChats.getState().openChat(res.chatId); else toast('মেসেজ রিকোয়েস্ট পাঠানো হয়েছে') }}
            className="px-5 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold">মেসেজ পাঠান</button>
          <button onClick={async () => {
            await api(`/me/blocked/${u.id}`, { method: blocked ? 'DELETE' : 'PUT' })
            setBlocked(!blocked)
            toast(blocked ? 'আনব্লক করা হয়েছে' : 'ব্লক করা হয়েছে — এখন কোনো মেসেজ আসবে না')
          }} className={`px-5 py-2 rounded-xl text-sm font-semibold ${blocked ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/10 text-rose-500'}`}>
            {blocked ? 'আনব্লক' : 'ব্লক করুন'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── ফরওয়ার্ড ──
function ForwardModal({ msg }: { msg: any }) {
  const chats = useChats((s) => s.chats)
  const closeModal = useUi((s) => s.closeModal)
  const toast = useUi((s) => s.toast)
  return (
    <>
      <ModalHeader title="ফরওয়ার্ড করুন" />
      <div className="p-2 overflow-y-auto max-h-[55vh]">
        {Object.values(chats).map((c) => (
          <button key={c.id} onClick={async () => {
            await useChats.getState().sendDraft(c.id, { type: msg.type, body: msg.body, media: msg.media, fwdFrom: msg.senderId })
            closeModal(); toast('ফরওয়ার্ড হয়েছে')
          }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-800">
            <Avatar name={c.title || c.peer?.username} id={c.id} avatarKey={c.kind === 'group' ? c.photoKey : c.peer?.avatarKey} size={40} />
            <span className="font-medium text-sm">{c.title || c.peer?.username}</span>
          </button>
        ))}
      </div>
    </>
  )
}

// ── এডিট ──
function EditModal({ chatId, msg }: { chatId: string; msg: any }) {
  const [text, setText] = useState(msg.body || '')
  const closeModal = useUi((s) => s.closeModal)
  return (
    <>
      <ModalHeader title="মেসেজ এডিট" />
      <div className="p-4">
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={4}
          className="w-full p-3 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-brand-500/30 resize-none" />
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={closeModal} className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm">বাতিল</button>
          <button onClick={async () => { await useChats.getState().editMessage(chatId, msg.id, text); closeModal() }}
            className="px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold">সেভ</button>
        </div>
      </div>
    </>
  )
}

// ── নতুন ডিভাইস অ্যাপ্রুভাল (পুশ থেকে আসে) ──
function DeviceApproval({ deviceId, deviceName }: { deviceId: string; deviceName: string }) {
  const closeModal = useUi((s) => s.closeModal)
  const decide = useAuth((s) => s.decideDevice)
  return (
    <>
      <ModalHeader title="🔐 নতুন ডিভাইস লগইন" />
      <div className="p-5">
        <p className="text-sm">
          <b>{deviceName}</b> থেকে আপনার অ্যাকাউন্টে লগইন করার চেষ্টা হচ্ছে। আপনিই কি করছেন?
        </p>
        <div className="flex gap-2 mt-5">
          <button onClick={async () => { await decide(deviceId, true); closeModal() }}
            className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-white font-semibold">Accept</button>
          <button onClick={async () => { await decide(deviceId, false); closeModal() }}
            className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white font-semibold">Decline</button>
        </div>
      </div>
    </>
  )
}

// ── মেসেজ রিকোয়েস্ট লিস্ট ──
function RequestsModal() {
  const requests = useChats((s) => s.requests)
  const respondRequest = useChats((s) => s.respondRequest)
  return (
    <>
      <ModalHeader title="মেসেজ রিকোয়েস্ট" />
      <div className="p-3 overflow-y-auto">
        {requests.length === 0 && <div className="text-center text-sm text-slate-400 py-8">কোনো রিকোয়েস্ট নেই</div>}
        {requests.map((r) => (
          <div key={r.id} className="flex items-center gap-3 px-2 py-2.5">
            <Avatar name={r.username} id={r.from_user} avatarKey={r.avatar_key} size={44} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">{r.username}</div>
              {r.about && <div className="text-xs text-slate-400 truncate">{r.about}</div>}
            </div>
            <button onClick={() => respondRequest(r.id, true)} className="px-3.5 py-1.5 rounded-xl bg-emerald-500 text-white text-xs font-bold">Accept</button>
            <button onClick={() => respondRequest(r.id, false)} className="px-3.5 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-xs font-bold">Decline</button>
          </div>
        ))}
      </div>
    </>
  )
}

// ── গ্রুপে কে দেখেছে ──
function SeenBy({ chatId, msgId }: { chatId: string; msgId: string }) {
  const chat = useChats((s) => s.chats[chatId])
  const seenBy = useChats((s) => (s as any).seenBy?.[msgId] || [])
  if (!chat) return null
  const viewers = chat.members.filter((m) => seenBy.includes(m.id) || m.id === useAuth.getState().user?.id)
  return (
    <>
      <ModalHeader title="কে দেখেছে" />
      <div className="p-4 max-h-[50vh] overflow-y-auto">
        {viewers.map((m) => (
          <div key={m.id} className="flex items-center gap-3 py-1.5">
            <Avatar name={m.username} id={m.id} avatarKey={m.avatarKey} size={36} />
            <span className="text-sm font-medium">{m.username}</span>
          </div>
        ))}
        {viewers.length <= 1 && <div className="text-sm text-slate-400 text-center py-4">এখনো কেউ দেখেনি</div>}
      </div>
    </>
  )
}

// ── ওয়ালপেপার ──
function WallpaperModal({ chatId }: { chatId: string }) {
  const chat = useChats((s) => s.chats[chatId])
  const patchChatState = useChats((s) => s.patchChatState)
  const closeModal = useUi((s) => s.closeModal)
  const fileRef = React.useRef<HTMLInputElement>(null)
  return (
    <>
      <ModalHeader title="চ্যাট ওয়ালপেপার" />
      <div className="p-5 space-y-3">
        <p className="text-sm text-slate-400">ছবি আপলোড করুন অথবা কোনো ইমেজ-ইউআরএল দিন।</p>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          try {
            // পুরো ডেটা-URL পাঠালে সার্ভারে ট্রাঙ্কেট হয়ে ওয়ালপেপার ভেঙে যেত —
            // তাই আগে কমপ্রেস করে ছোট করে নিই।
            const wallpaper = await wallpaperDataUrl(f)
            await patchChatState(chatId, { wallpaper })
            closeModal()
          } catch (err: any) {
            useUi.getState().toast(err?.message || 'ওয়ালপেপার সেট করা যায়নি')
          }
        }} />
        <div className="flex gap-2">
          <button onClick={() => fileRef.current?.click()} className="flex-1 py-2.5 rounded-xl bg-brand-600 text-white text-sm font-semibold">ছবি আপলোড</button>
          <button onClick={async () => {
            const url = prompt('ওয়ালপেপার ইমেজ ইউআরএল:')
            if (url) { await patchChatState(chatId, { wallpaper: url }); closeModal() }
          }} className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-semibold">ইউআরএল দিন</button>
        </div>
        {chat?.wallpaper && (
          <button onClick={async () => { await patchChatState(chatId, { wallpaper: '' }); closeModal() }}
            className="w-full py-2 rounded-xl text-rose-500 bg-rose-500/10 text-sm font-medium">ডিফল্টে ফিরুন</button>
        )}
      </div>
    </>
  )
}

export function ConfirmModal({ title, body, confirmText, onConfirm }: any) {
  const closeModal = useUi((s) => s.closeModal)
  return (
    <>
      <ModalHeader title={title || 'নিশ্চিত করুন'} />
      <div className="p-5">
        <p className="text-sm text-slate-500 dark:text-slate-300">{body}</p>
        <div className="flex gap-2 mt-5">
          <button onClick={closeModal} className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-semibold">বাতিল</button>
          <button onClick={async () => { await onConfirm?.(); closeModal() }} className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white text-sm font-semibold">{confirmText || 'হ্যাঁ'}</button>
        </div>
      </div>
    </>
  )
}
