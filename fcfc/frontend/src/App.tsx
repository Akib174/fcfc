// fcfc অ্যাপ শেল — অথেনটিকেশন গেট, চ্যাট লেআউট, ওভারলে, পুশ-আপডেট টোস্ট।
import React, { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import AuthScreen from './components/auth/AuthScreen'
import ChatList from './components/chat/ChatList'
import ChatWindow from './components/chat/ChatWindow'
import SettingsPanel from './components/settings/SettingsPanel'
import Modals from './components/modals/Modals'
import CallOverlay from './components/calls/CallOverlay'
import { ContextMenu, Toasts, Spinner } from './components/common'
import { useAuth } from './stores/auth'
import { useChats } from './stores/chats'
import { useUi } from './stores/ui'
import { IcLock } from './lib/icons'

export default function App() {
  const status = useAuth((s) => s.status)
  const activeChatId = useChats((s) => s.activeChatId)
  const panel = useUi((s) => s.panel)
  const call = useUi((s) => s.call)
  const mobileView = useUi((s) => s.mobileView)
  const setMobileView = useUi((s) => s.setMobileView)

  // বুট: টোকেন থাকলে সেশন লোড
  useEffect(() => { useAuth.getState().boot() }, [])
  useEffect(() => { if (status === 'ready') useChats.getState().boot() }, [status])

  // মোবাইল ভিউ সিঙ্ক
  useEffect(() => { setMobileView(activeChatId ? 'chat' : 'list') }, [activeChatId])

  // ইনভাইট লিংক: /#/join/<code>
  useEffect(() => {
    if (status !== 'ready') return
    const m = location.hash.match(/#\/join\/([\w-]+)/)
    if (m) {
      useChats.getState().joinInvite(m[1])
        .then((id) => { useChats.getState().openChat(id); history.replaceState(null, '', location.pathname) })
        .catch(() => useUi.getState().toast('ইনভাইট লিংকটি সঠিক নয়'))
    }
  }, [status])

  // PWA আপডেট টোস্ট
  useEffect(() => {
    const fn = () => useUi.getState().toast('✨ নতুন ভার্সন এসেছে — রিলোড করলেই পাবেন')
    window.addEventListener('fcfc:update-available', fn)
    return () => window.removeEventListener('fcfc:update-available', fn)
  }, [])

  if (status === 'boot') {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 chat-bg">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-2xl font-black shadow-xl shadow-brand-500/30">
          fc
        </motion.div>
        <Spinner className="text-brand-500" />
      </div>
    )
  }

  if (status === 'auth') return <AuthScreen />

  return (
    <div className="h-full flex relative overflow-hidden">
      {/* বাম: চ্যাট লিস্ট + সেটিংস ওভারলে */}
      <div className={`relative h-full w-full md:w-[380px] md:min-w-[340px] md:max-w-[380px] ${activeChatId && mobileView === 'chat' ? 'hidden md:block' : 'block'}`}>
        <ChatList />
        <AnimatePresence>{panel && <SettingsPanel />}</AnimatePresence>
      </div>

      {/* ডান: চ্যাট উইন্ডো */}
      <div className={`h-full flex-1 ${!activeChatId || mobileView === 'list' ? 'hidden md:flex' : 'flex'}`}>
        {activeChatId ? (
          <div className="flex-1 h-full">
            <ChatWindow key={activeChatId} chatId={activeChatId} />
          </div>
        ) : (
          <div className="flex-1 chat-bg flex items-center justify-center">
            <div className="text-center px-6 py-5 rounded-3xl bg-white/70 dark:bg-slate-900/70 backdrop-blur shadow-sm">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-xl font-black shadow-lg shadow-brand-500/25">fc</div>
              <div className="mt-3 font-bold text-lg">fcfc</div>
              <p className="text-sm text-slate-400 mt-1 max-w-[260px] flex items-center gap-1.5 justify-center">
                <IcLock size={13} /> এন্ড-টু-এন্ড এনক্রিপ্টেড · বাম দিক থেকে একটি চ্যাট বেছে নিন
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ওভারলে */}
      <Modals />
      <ContextMenu />
      <Toasts />
      <AnimatePresence>{call && <CallOverlay />}</AnimatePresence>
    </div>
  )
}
