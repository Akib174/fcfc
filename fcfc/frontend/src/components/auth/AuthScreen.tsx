// সাইনআপ / লগইন স্ক্রিন — অ্যানিমেটেড গ্রেডিয়েন্ট, রিয়েল-টাইম ইউজারনেম চেক,
// নো-রিকভারি সতর্কতা চেকবক্স, মাল্টি-ডিভাইস অ্যাপ্রুভাল পোলিং ভিউ।
import React, { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '../../stores/auth'
import { api } from '../../api/client'
import { Spinner } from '../common'
import { IcLock, IcCheck } from '../../lib/icons'

export default function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [nameStatus, setNameStatus] = useState<'idle' | 'checking' | 'ok' | 'taken' | 'invalid'>('idle')

  const { login, signup, pending, pendingNotice, cancelPending } = useAuth()

  // ইউজারনেম অ্যাভেইলেবিলিটি — টাইপ করার সাথে সাথে চেক
  useEffect(() => {
    if (mode !== 'signup') return
    const u = username.toLowerCase()
    if (!/^[a-z0-9_]{3,24}$/.test(u)) { setNameStatus(u ? 'invalid' : 'idle'); return }
    setNameStatus('checking')
    const t = setTimeout(async () => {
      try {
        const { ok } = await api(`/auth/check?username=${u}`, { noAuth: true })
        setNameStatus(ok ? 'ok' : 'taken')
      } catch { setNameStatus('idle') }
    }, 450)
    return () => clearTimeout(t)
  }, [username, mode])

  const canSubmit = useMemo(() => {
    if (busy) return false
    if (!username || password.length < 8) return false
    if (mode === 'signup') return understood && nameStatus === 'ok'
    return true
  }, [busy, username, password, mode, understood, nameStatus])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError('')
    try {
      const err = mode === 'signup' ? await signup(username, password, understood) : await login(username, password)
      if (err) setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full w-full flex items-center justify-center relative overflow-hidden chat-bg">
      {/* অ্যানিমেটেড ব্লার অর্ব */}
      <motion.div className="absolute w-[480px] h-[480px] rounded-full bg-brand-500/25 blur-3xl"
        animate={{ x: [-120, 80, -120], y: [-60, 100, -60] }} transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.div className="absolute w-[380px] h-[380px] rounded-full bg-violet-500/20 blur-3xl"
        animate={{ x: [100, -90, 100], y: [80, -80, 80] }} transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }} />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.2, 0.9, 0.3, 1] }}
        className="relative w-full max-w-md mx-4 bg-white/85 dark:bg-slate-900/85 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/60 dark:border-slate-700/50 p-8"
      >
        <div className="flex flex-col items-center mb-6">
          <motion.div
            className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 flex items-center justify-center text-white text-2xl font-black shadow-lg shadow-brand-500/30"
            whileHover={{ rotate: [0, -6, 6, 0] }} transition={{ duration: 0.5 }}
          >
            fc
          </motion.div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight">fcfc</h1>
          <p className="text-sm text-slate-400 mt-0.5 flex items-center gap-1"><IcLock size={13} /> এন্ড-টু-এন্ড এনক্রিপ্টেড</p>
        </div>

        <AnimatePresence mode="wait">
          {pending ? (
            <motion.div key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center">
              <div className="mx-auto w-14 h-14 rounded-full bg-brand-500/10 flex items-center justify-center text-brand-500 mb-4">
                <Spinner size={26} />
              </div>
              <div className="font-semibold text-lg">অনুমোদনের অপেক্ষায়…</div>
              <p className="text-sm text-slate-400 mt-2">
                আপনার অন্য ডিভাইসে একটি নোটিফিকেশন গেছে। সেখান থেকে <b>Accept</b> করলে এই ডিভাইসে লগইন হবে।
              </p>
              <button onClick={cancelPending} className="mt-6 px-5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-sm font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition">
                বাতিল করুন
              </button>
            </motion.div>
          ) : (
            <motion.form key={mode} onSubmit={submit} initial={{ opacity: 0, x: mode === 'signup' ? 24 : -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-4">
              {pendingNotice && <div className="text-sm text-rose-500 bg-rose-500/10 rounded-xl px-4 py-2.5">{pendingNotice}</div>}

              <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
                {(['login', 'signup'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => { setMode(m); setError('') }}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${mode === m ? 'bg-white dark:bg-slate-700 shadow text-brand-600 dark:text-brand-300' : 'text-slate-400'}`}>
                    {m === 'login' ? 'লগইন' : 'সাইনআপ'}
                  </button>
                ))}
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">ইউজারনেম</label>
                <div className="relative mt-1">
                  <input value={username} onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase())}
                    placeholder="you_name" autoComplete="username"
                    className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition outline-none" />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm">
                    {nameStatus === 'checking' && mode === 'signup' && <Spinner size={16} className="text-slate-400" />}
                    {nameStatus === 'ok' && <span className="text-emerald-500"><IcCheck size={17} /></span>}
                    {nameStatus === 'taken' && <span className="text-rose-500 text-xs font-medium">নামটি নেওয়া হয়ে গেছে</span>}
                    {nameStatus === 'invalid' && username && <span className="text-amber-500 text-xs font-medium">৩–২৪ অক্ষর (a-z, 0-9, _)</span>}
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide">পাসওয়ার্ড</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="কমপক্ষে ৮ অক্ষর" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  className="mt-1 w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition outline-none" />
              </div>

              {mode === 'signup' && (
                <label className="flex gap-3 items-start cursor-pointer rounded-xl bg-amber-500/10 border border-amber-500/20 p-3.5 select-none">
                  <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)}
                    className="mt-0.5 w-4.5 h-4.5 accent-brand-600 scale-110" />
                  <span className="text-[13px] leading-relaxed text-amber-700 dark:text-amber-300/90">
                    আমি বুঝেছি যে পাসওয়ার্ড বা ইউজারনেম হারিয়ে গেলে আমার অ্যাকাউন্ট এবং সব চ্যাট হিস্টোরি
                    স্থায়ীভাবে হারিয়ে যাবে — এটি কোনোভাবেই রিকভার করা যাবে না।
                  </span>
                </label>
              )}

              {error && <div className="text-sm text-rose-500 bg-rose-500/10 rounded-xl px-4 py-2.5">{error}</div>}

              <motion.button
                whileTap={{ scale: 0.97 }}
                disabled={!canSubmit}
                className="w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-brand-600 to-violet-600 shadow-lg shadow-brand-500/25 disabled:opacity-40 disabled:shadow-none transition flex items-center justify-center gap-2"
              >
                {busy ? <Spinner size={18} /> : mode === 'login' ? 'লগইন করুন' : 'অ্যাকাউন্ট তৈরি করুন'}
              </motion.button>

              {mode === 'signup' && (
                <p className="text-[11px] text-center text-slate-400 leading-relaxed">
                  কোনো ইমেইল/ফোন যাচাই নেই · কী আপনার ডিভাইসে তৈরি হয় · পাসওয়ার্ড থেকেই এনক্রিপ্টেড কী-ব্যাকআপ বানানো হয়
                </p>
              )}
            </motion.form>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
