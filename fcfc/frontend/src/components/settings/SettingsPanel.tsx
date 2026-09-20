// সেটিংস স্লাইড-ওভারলে — প্রোফাইল, প্রাইভেসি, নোটিফিকেশন, ডিভাইস/সেশন,
// ব্লকড লিস্ট, আর্কাইভড, স্টারড, অ্যাকাউন্ট ডিলিট।
import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../stores/auth'
import { useChats } from '../../stores/chats'
import { useUi } from '../../stores/ui'
import { api, mediaUrl } from '../../api/client'
import { Avatar, EmptyState, Switch } from '../common'
import { usePush } from '../../hooks/usePush'
import { fmtLastSeen } from '../../lib/utils'
import { IcBack, IcCamera, IcBell, IcLock, IcMoon, IcSun, IcLogout, IcUsers, IcArchive, IcStar, IcWallpaper, IcTrash } from '../../lib/icons'

type View = 'main' | 'profile' | 'privacy' | 'notifications' | 'devices' | 'blocked' | 'appearance' | 'account'

export default function SettingsPanel() {
  const panel = useUi((s) => s.panel)
  const setPanel = useUi((s) => s.setPanel)
  if (!panel) return null
  return (
    <motion.div
      initial={{ x: -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -40, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 350, damping: 32 }}
      className="absolute inset-0 z-40 bg-white dark:bg-[#111827] flex flex-col"
    >
      {panel === 'settings' && <SettingsBody />}
      {panel === 'archived' && <ArchivedView />}
      {panel === 'starred' && <StarredView />}
    </motion.div>
  )
}

function SettingsBody() {
  const [view, setView] = useState<View>('main')
  const setPanel = useUi((s) => s.setPanel)
  const { user, settings, updateProfile, updateSettings, logout, deleteAccount } = useAuth.getState()
  const toast = useUi((s) => s.toast)
  const theme = useUi((s) => s.theme)
  const toggleTheme = useUi((s) => s.toggleTheme)
  const subscribePush = usePush()
  const [about, setAbout] = useState(user?.about || '')
  const [devices, setDevices] = useState<any[]>([])
  const [current, setCurrent] = useState('')
  const [blocked, setBlocked] = useState<any[]>([])
  const [delPass, setDelPass] = useState('')

  useEffect(() => { if (view === 'devices') api('/me/devices').then((r) => { setDevices(r.devices); setCurrent(r.current) }) }, [view])
  useEffect(() => { if (view === 'blocked') api('/me/blocked').then((r) => setBlocked(r.results)) }, [view])

  if (!user) return null

  const Row = ({ icon, label, sub, onClick, right }: any) => (
    <button onClick={onClick} className="w-full flex items-center gap-3.5 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition text-left">
      <span className="text-slate-400">{icon}</span>
      <span className="flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        {sub && <span className="block text-xs text-slate-400 mt-0.5">{sub}</span>}
      </span>
      {right}
    </button>
  )

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-3 border-b border-slate-100 dark:border-slate-800">
        {view !== 'main' ? (
          <button onClick={() => setView('main')} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"><IcBack size={20} /></button>
        ) : (
          <button onClick={() => setPanel(null)} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"><IcBack size={20} /></button>
        )}
        <h2 className="font-bold text-lg">{{ profile: 'প্রোফাইল', privacy: 'প্রাইভেসি', notifications: 'নোটিফিকেশন', devices: 'ডিভাইস ও সেশন', blocked: 'ব্লকড ইউজার', appearance: 'থিম', account: 'অ্যাকাউন্ট', main: 'সেটিংস' }[view]}</h2>
      </div>

      <div className="flex-1 overflow-y-auto pb-8">
        {view === 'main' && (
          <>
            <button onClick={() => setView('profile')} className="w-full flex items-center gap-4 px-5 py-5 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition">
              <Avatar name={user.username} id={user.id} avatarKey={user.avatarKey} size={62} />
              <div className="text-left">
                <div className="text-lg font-bold">@{user.username}</div>
                <div className="text-sm text-slate-400 truncate max-w-[200px]">{user.about || 'About যোগ করুন…'}</div>
              </div>
            </button>
            <div className="border-t border-slate-100 dark:border-slate-800 mt-1" />
            <Row icon={<IcBell size={20} />} label="নোটিফিকেশন" sub="সাউন্ড, পুশ" onClick={() => setView('notifications')} />
            <Row icon={<IcLock size={20} />} label="প্রাইভেসি" sub="মেসেজ পারমিশন, লাস্ট সিন" onClick={() => setView('privacy')} />
            <Row icon={<IcUsers size={20} />} label="ডিভাইস ও সেশন" sub="অন্য ডিভাইস রিমোট লগআউট" onClick={() => setView('devices')} />
            <Row icon={<IcArchive size={20} />} label="আর্কাইভড চ্যাট" onClick={() => setPanel('archived')} />
            <Row icon={<IcStar size={20} />} label="স্টারড মেসেজ" onClick={() => setPanel('starred')} />
            <Row icon={<IcLock size={20} />} label="ব্লকড ইউজার" onClick={() => setView('blocked')} />
            <Row icon={theme === 'dark' ? <IcSun size={20} /> : <IcMoon size={20} />} label={theme === 'dark' ? 'লাইট থিম' : 'ডার্ক থিম'} onClick={toggleTheme} />
            <div className="border-t border-slate-100 dark:border-slate-800 mt-1" />
            <Row icon={<IcTrash size={20} />} label="অ্যাকাউন্ট ডিলিট" sub="স্থায়ীভাবে সব মুছে যাবে" onClick={() => setView('account')} />
            <Row icon={<IcLogout size={20} />} label="লগআউট" onClick={() => useUi.getState().openModal('confirm', { title: 'লগআউট', body: 'এই ডিভাইস থেকে লগআউট হবেন?', confirmText: 'লগআউট', onConfirm: () => logout() })} />
          </>
        )}

        {view === 'profile' && (
          <div className="p-5 space-y-4">
            <div className="flex justify-center">
              <div className="relative">
                <Avatar name={user.username} id={user.id} avatarKey={user.avatarKey} size={100} />
                <label className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-brand-600 text-white flex items-center justify-center cursor-pointer shadow-lg">
                  <IcCamera size={17} />
                  <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    await api('/me/avatar', { method: 'POST', body: f, headers: { 'content-type': f.type } })
                    toast('প্রোফাইল ছবি আপডেট হয়েছে')
                    useAuth.getState().updateProfile({})
                  }} />
                </label>
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase">ইউজারনেম (পরিবর্তনযোগ্য নয়)</label>
              <div className="mt-1 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 opacity-70">@{user.username}</div>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase">About / Bio</label>
              <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={2} maxLength={200}
                className="mt-1 w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-brand-500/30 resize-none" />
              <button onClick={async () => { await updateProfile({ about }); toast('সেভ হয়েছে') }}
                className="mt-2 px-5 py-2 rounded-xl bg-brand-600 text-white text-sm font-semibold">সেভ করুন</button>
            </div>
          </div>
        )}

        {view === 'privacy' && (
          <div className="p-5 space-y-5">
            <div>
              <div className="font-semibold text-sm mb-1">কে সরাসরি মেসেজ করতে পারবে</div>
              <p className="text-xs text-slate-400 mb-2">"শুধু রিকোয়েস্ট" সিলেক্ট করলে সার্চ করে সরাসরি চ্যাট শুরু করা যাবে না — রিকোয়েস্ট পাঠাতে হবে।</p>
              <div className="flex gap-2">
                {[['everyone', 'সবাই'], ['request', 'শুধু রিকোয়েস্ট']].map(([v, l]) => (
                  <button key={v} onClick={async () => { await updateProfile({ privacyDm: v }); toast('আপডেট হয়েছে') }}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold ${user.privacyDm === v || (!user.privacyDm && v === 'everyone') ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}>{l}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="font-semibold text-sm mb-2">লাস্ট সিন কে দেখতে পাবে</div>
              <div className="flex gap-2">
                {[['everyone', 'সবাই'], ['nobody', 'কেউ না']].map(([v, l]) => (
                  <button key={v} onClick={async () => { await updateProfile({ lastseenPriv: v }); toast('আপডেট হয়েছে') }}
                    className={`px-4 py-2 rounded-xl text-sm font-semibold ${(user.lastSeenPriv || 'everyone') === v ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-slate-800'}`}>{l}</button>
                ))}
              </div>
            </div>
            <div className="text-xs text-slate-400 bg-slate-50 dark:bg-slate-800/70 rounded-xl p-3.5 leading-relaxed">
              🔐 সব মেসেজ এন্ড-টু-এন্ড এনক্রিপ্টেড। সার্ভার শুধু এনক্রিপ্টেড ডেটা দেখে — আপনার প্রাইভেট কী কখনো ডিভাইসের বাইরে যায় না।
            </div>
          </div>
        )}

        {view === 'notifications' && (
          <div className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div><div className="font-medium text-sm">নোটিফিকেশন সাউন্ড</div><div className="text-xs text-slate-400">নতুন মেসেজে পিং শব্দ</div></div>
              <Switch on={settings.sound !== false} onChange={(v) => updateSettings({ sound: v })} />
            </div>
            <div className="flex items-center justify-between">
              <div><div className="font-medium text-sm">ব্রাউজার পুশ নোটিফিকেশন</div><div className="text-xs text-slate-400">অ্যাপ বন্ধ থাকলেও ট্রে-তে আসবে</div></div>
              <button onClick={async () => { const ok = await subscribePush(); toast(ok ? 'পুশ চালু হয়েছে ✅' : 'পুশ চালু করা যায়নি') }}
                className="px-4 py-2 rounded-xl bg-brand-600 text-white text-xs font-bold">চালু করুন</button>
            </div>
            <p className="text-xs text-slate-400">প্রতি-চ্যাট মিউট (৮ ঘণ্টা / ১ দিন / সবসময়) চ্যাট লিস্টে রাইট-ক্লিক করে পাওয়া যায়।</p>
          </div>
        )}

        {view === 'devices' && (
          <div className="p-4">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <span className={`w-2.5 h-2.5 rounded-full ${d.approved ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{d.name} {d.id === current && <span className="text-brand-500 text-xs">(এই ডিভাইস)</span>}</div>
                  <div className="text-xs text-slate-400">সর্বশেষ সক্রিয়: {d.last_active ? fmtLastSeen(d.last_active) : '—'} {!d.approved && '· অনুমোদনের অপেক্ষায়'}</div>
                </div>
                {d.id !== current && (
                  <button onClick={async () => { await api(`/me/devices/${d.id}`, { method: 'DELETE' }); setDevices(devices.filter((x) => x.id !== d.id)); toast('সেশন বন্ধ করা হয়েছে') }}
                    className="text-xs px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-500 font-semibold">লগআউট</button>
                )}
              </div>
            ))}
            {devices.length === 0 && <div className="text-center text-sm text-slate-400 py-8">কোনো ডিভাইস তথ্য নেই</div>}
          </div>
        )}

        {view === 'blocked' && (
          <div className="p-4">
            {blocked.length === 0 && <EmptyState icon={<IcLock size={26} />} title="কেউ ব্লকড নেই" />}
            {blocked.map((b) => (
              <div key={b.id} className="flex items-center gap-3 px-3 py-2.5">
                <Avatar name={b.username} id={b.id} avatarKey={b.avatarKey} size={40} />
                <span className="flex-1 text-sm font-medium">@{b.username}</span>
                <button onClick={async () => { await api(`/me/blocked/${b.id}`, { method: 'DELETE' }); setBlocked(blocked.filter((x) => x.id !== b.id)) }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 font-semibold">আনব্লক</button>
              </div>
            ))}
          </div>
        )}

        {view === 'account' && (
          <div className="p-5 space-y-4">
            <div className="text-sm text-rose-500 bg-rose-500/10 rounded-xl p-4 leading-relaxed">
              ⚠️ অ্যাকাউন্ট ডিলিট করলে: প্রোফাইল, ইউজারনেম, এনক্রিপ্টেড কী-ব্যাকআপ সব মুছে যাবে।
              ১:১ চ্যাটে অন্যরা দেখবে "ব্যবহারকারী অ্যাকাউন্ট ডিলিট করেছেন"; গ্রুপ থেকে আপনি সরে যাবেন।
              <b> এটি কখনোই ফেরত আনা যাবে না।</b>
            </div>
            <input type="password" value={delPass} onChange={(e) => setDelPass(e.target.value)} placeholder="পাসওয়ার্ড দিয়ে নিশ্চিত করুন"
              className="w-full px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 outline-none focus:ring-2 focus:ring-rose-500/30" />
            <button disabled={!delPass} onClick={async () => {
              const err = await deleteAccount(delPass)
              if (err) toast(err)
              else toast('অ্যাকাউন্ট মুছে ফেলা হয়েছে')
            }} className="w-full py-2.5 rounded-xl bg-rose-500 text-white font-semibold disabled:opacity-40">স্থায়ীভাবে অ্যাকাউন্ট ডিলিট করুন</button>
          </div>
        )}
      </div>
    </>
  )
}

function ArchivedView() {
  const chats = useChats((s) => s.chats)
  const setPanel = useUi((s) => s.setPanel)
  const patchChatState = useChats((s) => s.patchChatState)
  const archived = Object.values(chats).filter((c) => c.archived)
  return (
    <>
      <div className="flex items-center gap-2 px-3 py-3 border-b border-slate-100 dark:border-slate-800">
        <button onClick={() => setPanel(null)} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"><IcBack size={20} /></button>
        <h2 className="font-bold text-lg">আর্কাইভড চ্যাট</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {archived.length === 0 && <EmptyState icon={<IcArchive size={26} />} title="কোনো আর্কাইভড চ্যাট নেই" />}
        {archived.map((c) => (
          <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800/60">
            <Avatar name={c.title || c.peer?.username} id={c.id} avatarKey={c.kind === 'group' ? c.photoKey : c.peer?.avatarKey} size={44} />
            <span className="flex-1 font-medium text-sm truncate">{c.title || c.peer?.username}</span>
            <button onClick={() => patchChatState(c.id, { archived: false })} className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700 font-semibold">আনআর্কাইভ</button>
          </div>
        ))}
      </div>
    </>
  )
}

function StarredView() {
  const [msgs, setMsgs] = useState<any[]>([])
  const chats = useChats((s) => s.chats)
  const setPanel = useUi((s) => s.setPanel)
  useEffect(() => { useChats.getState().starredList().then(setMsgs) }, [])
  return (
    <>
      <div className="flex items-center gap-2 px-3 py-3 border-b border-slate-100 dark:border-slate-800">
        <button onClick={() => setPanel(null)} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"><IcBack size={20} /></button>
        <h2 className="font-bold text-lg">স্টারড মেসেজ</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {msgs.length === 0 && <EmptyState icon={<IcStar size={26} />} title="কোনো স্টারড মেসেজ নেই" sub="মেসেজে রাইট-ক্লিক করে ⭐ স্টার করুন" />}
        {msgs.map((m) => (
          <button key={m.id} onClick={() => { setPanel(null); useChats.getState().openChat(m.chatId) }}
            className="w-full text-left px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800">
            <div className="text-xs font-semibold text-brand-500">{chats[m.chatId]?.title || chats[m.chatId]?.peer?.username || 'চ্যাট'}</div>
            <div className="text-sm mt-1 truncate">{m.body || `(${m.type})`}</div>
          </button>
        ))}
      </div>
    </>
  )
}
