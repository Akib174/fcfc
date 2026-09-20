// ছোট শেয়ার্ড কম্পোনেন্ট: অ্যাভাটার, টোস্ট, কনটেক্সট মেনু, স্পিনার।
import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { avatarColor, initials } from '../lib/utils'
import { mediaUrl } from '../api/client'
import { useUi } from '../stores/ui'

export function Avatar({ name = '?', id = '', avatarKey, size = 44, online, ring }: {
  name?: string; id?: string; avatarKey?: string; size?: number; online?: boolean; ring?: boolean
}) {
  const url = avatarKey ? mediaUrl(avatarKey) : ''
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {url ? (
        <img src={url} alt={name} className="w-full h-full rounded-full object-cover" loading="lazy" />
      ) : (
        <div
          className="w-full h-full rounded-full flex items-center justify-center text-white font-semibold select-none"
          style={{ background: `linear-gradient(135deg, ${avatarColor(id || name)}, ${avatarColor((id || name) + 'x')}cc)`, fontSize: size * 0.38 }}
        >
          {initials(name)}
        </div>
      )}
      {ring && <div className="absolute inset-0 rounded-full ring-2 ring-brand-500/70" />}
      {online && (
        <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-slate-900" />
      )}
    </div>
  )
}

export function Spinner({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21.5 12a9.5 9.5 0 00-9.5-9.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] flex flex-col gap-2 items-center pointer-events-none">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            className="px-4 py-2.5 rounded-xl bg-slate-900/92 dark:bg-slate-700/95 text-white text-sm shadow-xl backdrop-blur"
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function ContextMenu() {
  const menu = useUi((s) => s.menu)
  const closeMenu = useUi((s) => s.closeMenu)
  return (
    <AnimatePresence>
      {menu && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={closeMenu} onContextMenu={(e) => { e.preventDefault(); closeMenu() }} />
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.12 }}
            className="fixed z-[71] min-w-[190px] py-1.5 rounded-xl bg-white dark:bg-slate-800 shadow-2xl border border-slate-200/70 dark:border-slate-700/70 overflow-hidden"
            style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - menu.items.length * 40 - 20) }}
          >
            {menu.items.map((it, i) => (
              <button
                key={i}
                onClick={() => { closeMenu(); it.onClick() }}
                className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2.5 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700/60 ${it.danger ? 'text-rose-500' : 'text-slate-700 dark:text-slate-200'}`}
              >
                {it.label}
              </button>
            ))}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`w-11 h-6.5 rounded-full p-0.5 transition-colors h-7 ${on ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-600'}`}
    >
      <motion.div layout className="w-6 h-6 rounded-full bg-white shadow" animate={{ x: on ? 18 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 32 }} />
    </button>
  )
}

export function EmptyState({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-8 gap-3">
      <div className="w-16 h-16 rounded-2xl bg-slate-200/60 dark:bg-slate-800 flex items-center justify-center text-slate-400">{icon}</div>
      <div className="font-semibold text-slate-600 dark:text-slate-300">{title}</div>
      {sub && <div className="text-sm text-slate-400 max-w-xs">{sub}</div>}
    </div>
  )
}
