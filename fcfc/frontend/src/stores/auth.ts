// অথেনটিকেশন স্টেট — সাইনআপ, মাল্টি-ডিভাইস লগইন-অ্যাপ্রুভাল, কী রিস্টোর/আপলোড।
import { create } from 'zustand'
import { api, setTokens, getTokens } from '../api/client'
import { createIdentityBundle, loadIdentityBundle, publicBundleForUpload } from '../crypto/keys'
import { syncBackup, createBackup, restoreBackup } from '../crypto/backup'
import { idb } from '../lib/db'
import { b64u } from '../lib/utils'
import type { User } from '../types'

// ভারী পাসওয়ার্ড-হ্যাশিং ব্রাউজারেই হয় (Workers ফ্রি প্ল্যানের ১০ms CPU-লিমিটের কারণে)।
// সার্ভারে পাঠানো হয় PBKDF2-ডিরাইভড হ্যাশ, আসল পাসওয়ার্ড নয়।
async function clientPassHash(username: string, password: string): Promise<string> {
  const salt = new TextEncoder().encode('fcfc-v1:' + username.toLowerCase())
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: 600_000 },
    base, 256,
  )
  return b64u(new Uint8Array(bits))
}

export type BootStatus = 'boot' | 'auth' | 'ready'

interface AuthState {
  status: BootStatus
  user: User | null
  settings: any
  pending: { deviceId: string; secret: string } | null
  pendingNotice: string | null
  password: string | null // শুধু ব্যাকআপ সিঙ্কের জন্য সেশন-মেমোরিতে

  boot(): Promise<void>
  signup(username: string, password: string, understood: boolean): Promise<string | null>
  login(username: string, password: string): Promise<string | null>
  cancelPending(): void
  decideDevice(deviceId: string, accept: boolean): Promise<void>
  updateProfile(patch: Record<string, any>): Promise<void>
  updateSettings(patch: Record<string, any>): Promise<void>
  deleteAccount(password: string): Promise<string | null>
  logout(remote?: boolean): Promise<void>
  forceLogout(): void
}

const deviceName = () => {
  const ua = navigator.userAgent
  const browser = ua.includes('Firefox') ? 'Firefox' : ua.includes('Edg') ? 'Edge' : ua.includes('Chrome') ? 'Chrome' : 'Safari'
  const os = ua.includes('Windows') ? 'Windows' : ua.includes('Mac') ? 'macOS' : ua.includes('Android') ? 'Android' : ua.includes('Linux') ? 'Linux' : ua.includes('iPhone') ? 'iOS' : 'ডিভাইস'
  return `${browser} · ${os}`
}

let pollTimer: any = null

export const useAuth = create<AuthState>((set, get) => ({
  status: 'boot',
  user: null,
  settings: {},
  pending: null,
  pendingNotice: null,
  password: null,

  async boot() {
    const toks = getTokens()
    if (!toks) return set({ status: 'auth' })
    try {
      const { user, settings } = await api('/me')
      set({ user, settings: settings || {}, status: 'ready' })
    } catch {
      setTokens(null)
      set({ status: 'auth' })
    }
  },

  async signup(username, password, understood) {
    try {
      // কী-পেয়ার আগেই তৈরি হয়, তারপর অ্যাকাউন্ট
      const bundle = await createIdentityBundle()
      const keys = await publicBundleForUpload(bundle)
      const passHash = await clientPassHash(username, password)
      const res = await api('/auth/signup', {
        noAuth: true,
        body: { username, password: passHash, understood, deviceName: deviceName(), keys },
      })
      setTokens({ access: res.access, refresh: res.refresh })
      set({ password })
      const { user, settings } = await api('/me')
      set({ user, settings: settings || {}, status: 'ready' })
      await syncBackup(password)
      return null
    } catch (e: any) {
      return e.message || 'সাইনআপ ব্যর্থ'
    }
  },

  async login(username, password) {
    try {
      const passHash = await clientPassHash(username, password)
      const res = await api('/auth/login', { noAuth: true, body: { username, password: passHash, deviceName: deviceName() } })
      if (res.pending) {
        set({ pending: { deviceId: res.deviceId, secret: res.secret }, pendingNotice: null })
        startPolling(set, get, password)
        return null
      }
      return finishLogin(set, get, res.access, res.refresh, password)
    } catch (e: any) {
      return e.message || 'লগইন ব্যর্থ'
    }
  },

  cancelPending() {
    clearInterval(pollTimer)
    set({ pending: null })
  },

  async decideDevice(deviceId, accept) {
    await api(`/auth/devices/${deviceId}/decision`, { body: { accept } })
  },

  async updateProfile(patch) {
    await api('/me', { method: 'PATCH', body: patch })
    const { user } = await api('/me')
    set({ user })
  },

  async updateSettings(patch) {
    const merged = { ...get().settings, ...patch }
    await api('/me', { method: 'PATCH', body: { settings: merged } })
    set({ settings: merged })
  },

  async deleteAccount(password) {
    try {
      const me = get().user
      const passHash = await clientPassHash(me?.username || '', password)
      await api('/me/account', { method: 'DELETE', body: { password: passHash } })
      setTokens(null)
      set({ user: null, status: 'auth', password: null })
      return null
    } catch (e: any) {
      return e.message || 'ব্যর্থ'
    }
  },

  async logout(remote = false) {
    try { await api('/auth/logout', { body: { device: remote } }) } catch {}
    clearInterval(pollTimer)
    setTokens(null)
    set({ user: null, status: 'auth', pending: null, password: null })
  },

  forceLogout() {
    clearInterval(pollTimer)
    setTokens(null)
    set({ user: null, status: 'auth', pending: null, password: null })
  },
}))

window.addEventListener('fcfc:force-logout', () => useAuth.getState().forceLogout())

function startPolling(set: any, get: any, password: string) {
  clearInterval(pollTimer)
  pollTimer = setInterval(async () => {
    const p = get().pending
    if (!p) return clearInterval(pollTimer)
    try {
      const res = await api('/auth/login/poll', { noAuth: true, body: { deviceId: p.deviceId, secret: p.secret } })
      if (res.pending) return
      clearInterval(pollTimer)
      set({ pending: null })
      await finishLogin(set, get, res.access, res.refresh, password)
    } catch (e: any) {
      clearInterval(pollTimer)
      set({ pending: null, pendingNotice: e.message === 'declined' ? 'লগইন রিকোয়েস্ট বাতিল করা হয়েছে' : 'লগইন ব্যর্থ হয়েছে' })
    }
  }, 2500)
}

async function finishLogin(set: any, get: any, access: string, refresh: string, password: string) {
  setTokens({ access, refresh })
  set({ password })
  const { user, settings } = await api('/me')
  set({ user, settings: settings || {}, status: 'ready' })

  // কী রিস্টোরেশন: লোকালে কী আছে? নাহলে পাসওয়ার্ড দিয়ে ব্যাকআপ থেকে
  const hasLocal = !!(await idb.get('keys', 'identity'))
  if (!hasLocal) {
    const backup = await api('/me/backup')
    if (backup?.blob) {
      await restoreBackup(password, backup.blob, backup.salt)
    } else {
      // নতুন ডিভাইস + কোনো ব্যাকআপ নেই → নতুন আইডেন্টিটি
      const bundle = await createIdentityBundle()
      await api('/me/keys', { body: await publicBundleForUpload(bundle) })
      const { blob, salt } = await createBackup(password)
      await api('/me/backup', { method: 'PUT', body: { blob, salt } })
    }
  } else {
    await syncBackup(password).catch(() => {})
  }
}
