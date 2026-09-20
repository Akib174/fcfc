// HTTP API ক্লায়েন্ট — টোকেন ম্যানেজমেন্ট, অটো-রিফ্রেশ।
// ডোমেইন কোথাও হার্ডকোড নেই; `VITE_API_BASE` এনভ থেকে আসে।
export const API_BASE = String(import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
export const WS_BASE = API_BASE.replace(/^http/, 'ws')

type Toks = { access: string; refresh: string }

export function getTokens(): Toks | null {
  try {
    const raw = localStorage.getItem('fcfc.toks')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
export function setTokens(t: Toks | null) {
  if (!t) localStorage.removeItem('fcfc.toks')
  else localStorage.setItem('fcfc.toks', JSON.stringify(t))
}
export function accessToken() { return getTokens()?.access || '' }

let refreshing: Promise<boolean> | null = null
async function tryRefresh(): Promise<boolean> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    const t = getTokens()
    if (!t?.refresh) return false
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refresh: t.refresh }),
      })
      if (!res.ok) return false
      const j = await res.json()
      setTokens({ access: j.access, refresh: t.refresh })
      return true
    } catch { return false }
    finally { refreshing = null }
  })()
  return refreshing
}

export interface ApiOpts {
  method?: string
  body?: any
  raw?: boolean
  noAuth?: boolean
  headers?: Record<string, string>
}

export async function api<T = any>(path: string, opts: ApiOpts = {}): Promise<T> {
  const doFetch = async () => {
    const headers: Record<string, string> = { ...(opts.headers || {}) }
    if (opts.body !== undefined && !(opts.body instanceof Blob) && !(opts.body instanceof ArrayBuffer)) {
      headers['content-type'] = 'application/json'
    }
    if (!opts.noAuth) {
      const t = accessToken()
      if (t) headers['authorization'] = `Bearer ${t}`
    }
    return fetch(`${API_BASE}${path}`, {
      method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined
        ? (opts.body instanceof Blob || opts.body instanceof ArrayBuffer ? opts.body : JSON.stringify(opts.body))
        : undefined,
    })
  }

  let res = await doFetch()
  if (res.status === 401 && !opts.noAuth) {
    if (await tryRefresh()) res = await doFetch()
    else { window.dispatchEvent(new Event('fcfc:force-logout')); throw new Error('unauthorized') }
  }
  if (opts.raw) return res as unknown as T
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(e.error || `HTTP ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// মিডিয়া কী-তে `/` থাকে (files/<uid>/xxx) — পুরো কী একসাথে encodeURIComponent
// করলে স্ল্যাশ `%2F` হয়ে যায় আর সার্ভারের রুট ম্যাচ করে না (404)।
// তাই প্রতিটি সেগমেন্ট আলাদা করে এনকোড করি, স্ল্যাশ যথাস্থানে থাকে।
export const mediaPath = (key: string) => key.split('/').map(encodeURIComponent).join('/')

export const mediaUrl = (key?: string) =>
  key ? `${API_BASE}/media/${mediaPath(key)}?token=${encodeURIComponent(accessToken())}` : ''

export const wsUrl = (path: string) => `${WS_BASE}${path}?token=${encodeURIComponent(accessToken())}`
