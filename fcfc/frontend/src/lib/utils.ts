export const cls = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ')

export const uid = (p = '') => p + crypto.randomUUID().replace(/-/g, '').slice(0, 20)

export const initials = (name = '?') =>
  name.replace(/[^a-zA-Z0-9\u0980-\u09FF]/g, '').slice(0, 2).toUpperCase() || '?'

const AV_COLORS = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#2dd4bf', '#60a5fa', '#a78bfa', '#f472b6']
export function avatarColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return AV_COLORS[h % AV_COLORS.length]
}

export function fmtTime(ts: number) {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function fmtDay(ts: number) {
  const d = new Date(ts)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'আজ'
  const y = new Date(today.getTime() - 864e5)
  if (d.toDateString() === y.toDateString()) return 'গতকাল'
  return d.toLocaleDateString([], { day: 'numeric', month: 'long', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined })
}

export function fmtLastSeen(ts?: number) {
  if (!ts) return 'অনেক দিন আগে'
  const diff = Date.now() - ts
  if (diff < 60_000) return 'এইমাত্র'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} মিনিট আগে`
  if (diff < 864e5) return `${Math.floor(diff / 3600_000)} ঘণ্টা আগে`
  return new Date(ts).toLocaleDateString()
}

export function fmtSize(n = 0) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let t: any
  return (...args: any[]) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms) }
}

export const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi

export function extractUrl(text: string): string | null {
  const m = text.match(URL_RE)
  return m ? m[0] : null
}

export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function b64uToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
}

export const MUTE_OPTIONS = [
  { label: '৮ ঘণ্টা', ms: 8 * 3600_000 },
  { label: '১ দিন', ms: 24 * 3600_000 },
  { label: 'সবসময়', ms: 3650 * 24 * 3600_000 },
]
