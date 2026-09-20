// পাসওয়ার্ড-ডিরাইভড কী-ব্যাকআপ (মাল্টি-ডিভাইস রিস্টোর)।
// পাসওয়ার্ড থেকে PBKDF2 (600k) দিয়ে কী ডেরাইভ → প্রাইভেট কী বান্ডিল
// ক্লায়েন্ট-সাইডে এনক্রিপ্ট → এনক্রিপ্টেড ব্লব সার্ভারে। সার্ভার কখনো
// ডিক্রিপ্ট করতে পারে না; পাসওয়ার্ড হারালে ব্লব উদ্ধার অসম্ভব।
import { idb } from '../lib/db'
import { api } from '../api/client'
import { b64u, b64uToBytes } from '../lib/utils'

const ITER = 600_000

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITER },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function collectBundle(): Promise<string> {
  const stores = ['keys', 'sessions', 'senderKeys']
  const dump: Record<string, any> = {}
  for (const s of stores) {
    const entries: Record<string, any> = {}
    for (const k of await idb.allKeys(s)) entries[String(k)] = await idb.get(s, k)
    dump[s] = entries
  }
  return JSON.stringify(dump)
}

export async function createBackup(password: string): Promise<{ blob: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(password, salt)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource }, key,
    new TextEncoder().encode(await collectBundle()) as BufferSource,
  )
  // layout: iv(12) || ciphertext
  const combined = new Uint8Array(12 + ct.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ct), 12)
  return { blob: b64u(combined), salt: b64u(salt) }
}

export async function restoreBackup(password: string, blob: string, saltB64: string): Promise<boolean> {
  try {
    const key = await deriveKey(password, b64uToBytes(saltB64))
    const data = b64uToBytes(blob)
    const iv = data.slice(0, 12)
    const ct = data.slice(12)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource)
    const dump = JSON.parse(new TextDecoder().decode(plain))
    for (const [store, entries] of Object.entries<any>(dump)) {
      for (const [k, v] of Object.entries(entries)) {
        await idb.put(store, k, v)
      }
    }
    return true
  } catch {
    return false
  }
}

// সাইনআপ/লগইনের পর কল করা হয়: লোকাল কী থাকলে আপলোড, না থাকলে রিস্টোরের চেষ্টা
export async function syncBackup(password: string) {
  const remote = await api('/me/backup')
  const hasLocal = !!(await idb.get('keys', 'identity'))
  if (hasLocal) {
    const { blob, salt } = await createBackup(password)
    await api('/me/backup', { method: 'PUT', body: { blob, salt } })
    return 'uploaded'
  }
  if (remote?.blob) {
    const ok = await restoreBackup(password, remote.blob, remote.salt)
    return ok ? 'restored' : 'failed'
  }
  return 'none'
}
