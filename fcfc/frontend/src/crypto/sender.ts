// গ্রুপ চ্যাট: Sender Keys মডেল (Signal-এর মতো)।
// প্রতিটি সদস্য প্রতি গ্রুপে একটি সিমেট্রিক চেইন-কী রাখে, যেটা অন্য সব
// সদস্যকে 1:1 এনক্রিপ্টেড চ্যানেলে পাঠানো হয়। নতুন মেম্বার জয়েন করলে
// বিদ্যমান মেম্বাররা তাদের কারেন্ট চেইন-স্টেট শেয়ার করে — ফলে নতুন মেম্বার
// আগের এনক্রিপ্টেড হিস্টোরিও ডিক্রিপ্ট করতে পারে।
import { idb } from '../lib/db'
import { b64u, b64uToBytes } from '../lib/utils'
import { hkdf, kdfChain } from './ratchet'

const te = new TextEncoder()
const td = new TextDecoder()

export interface SenderKeyState {
  chainKey: string
  idx: number
  // আউট-অফ-অর্ডার ডেলিভারির জন্য স্কিপ করা মেসেজ-কীগুলো (`n` → b64u)।
  // আগে এগুলো হিসাব হয়েও সেভ হতো না — ফলে বর্তমান idx-এর চেয়ে পুরনো
  // মেসেজ (হিস্টোরি লোড ইত্যাদি) আর কখনো ডিক্রিপ্ট করা যেত না।
  skipped?: Record<number, string>
}

// ── নিজের সেন্ডার কী ──
// জেনেসিস-কী (চেইনের একদম শুরু) আলাদা করে রাখা হয় — নতুন মেম্বারকে এটা
// দিলে সে পুরনো হিস্টোরিও ডিক্রিপ্ট করতে পারে (স্পেক-অনুরোধ)।
export async function ownSenderKey(chatId: string): Promise<SenderKeyState> {
  let skState = await idb.get<SenderKeyState>('senderKeys', `own:${chatId}`)
  if (!skState) {
    const raw = crypto.getRandomValues(new Uint8Array(32))
    skState = { chainKey: b64u(raw), idx: 0 }
    await idb.put('senderKeys', `own:${chatId}`, skState)
    await idb.put('senderKeys', `gen:${chatId}`, skState.chainKey)
  }
  return skState
}

// অন্য সদস্যের কাছ থেকে পাওয়া কী ইনজেস্ট
export async function ingestSenderKey(chatId: string, senderId: string, sk: SenderKeyState) {
  // রি-ডিস্ট্রিবিউশনে (জেনেসিস, idx 0) স্টেট রিসেট হয় — আগের স্কিপ-কীগুলো
  // একই চেইনের, তাই সেগুলো বজায় রাখি।
  const existing = await idb.get<SenderKeyState>('senderKeys', `${chatId}:${senderId}`)
  await idb.put('senderKeys', `${chatId}:${senderId}`, { chainKey: sk.chainKey, idx: sk.idx, skipped: existing?.skipped })
}

export const hasSenderKey = async (chatId: string, senderId: string) =>
  !!(await idb.get('senderKeys', `${chatId}:${senderId}`))

// বিতরণের জন্য প্যাকেট — জেনেসিস স্টেট (idx 0), যেন নতুন মেম্বার
// পুরনো মেসেজও পড়তে পারে। রিসিভার চেইন প্রয়োজনমতো এগিয়ে নেয়।
export async function distributionPackage(chatId: string) {
  const current = await ownSenderKey(chatId)
  const genesis = (await idb.get<string>('senderKeys', `gen:${chatId}`)) || current.chainKey
  return { chainKey: genesis, idx: 0 }
}

// বিতরণ ট্র্যাকিং — কাকে কাকে পাঠানো হয়েছে
export async function markDistributed(chatId: string, userId: string) {
  const key = `skdist:${chatId}`
  const m = (await idb.get('meta', key)) || {}
  m[userId] = Date.now()
  await idb.put('meta', key, m)
}
export async function distributedSet(chatId: string): Promise<Set<string>> {
  const m = (await idb.get('meta', `skdist:${chatId}`)) || {}
  return new Set(Object.keys(m))
}
// নতুন মেম্বার এলে ওর জন্য সবাই আবার বিতরণ করবে
export async function markNeedsRedistribution(chatId: string, newMemberIds: string[]) {
  const key = `skdist:${chatId}`
  const m = (await idb.get('meta', key)) || {}
  for (const id of newMemberIds) delete m[id]
  await idb.put('meta', key, m)
}

export interface GroupEnvelope { v: 1; g: 1; sid: string; n: number; ct: string; iv: string }

export async function groupEncrypt(chatId: string, myUserId: string, obj: any): Promise<GroupEnvelope> {
  const sk = await ownSenderKey(chatId)
  const chainKey = b64uToBytes(sk.chainKey)
  const n = sk.idx
  const [mk, next] = await kdfChain(chainKey)
  sk.idx += 1
  sk.chainKey = b64u(next)
  await idb.put('senderKeys', `own:${chatId}`, sk)

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const k = await crypto.subtle.importKey('raw', mk as BufferSource, 'AES-GCM', false, ['encrypt'])
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, k, te.encode(JSON.stringify(obj)) as BufferSource)
  return { v: 1, g: 1, sid: myUserId, n, ct: b64u(ct), iv: b64u(iv) }
}

export async function groupDecrypt(chatId: string, senderId: string, env: GroupEnvelope): Promise<any> {
  const sk = await idb.get<SenderKeyState>('senderKeys', `${chatId}:${senderId}`)
  if (!sk) throw new Error('sender key missing')
  const skipped: Record<number, string> = { ...(sk.skipped || {}) }
  let msgKey: Uint8Array | null = null

  if (env.n < sk.idx) {
    // পুরনো মেসেজ (আউট-অফ-অর্ডার / হিস্টোরি) — স্কিপ-লিস্ট থেকে কী নিই
    const mk = skipped[env.n]
    if (!mk) throw new Error('sender key missing')
    msgKey = b64uToBytes(mk)
    delete skipped[env.n]
    await idb.put('senderKeys', `${chatId}:${senderId}`, { ...sk, skipped })
  } else {
    // গ্যাপ থাকলে চেইন এগিয়ে নিই — মাঝের কীগুলো স্কিপ-লিস্টে জমা থাকে
    let chainKey = b64uToBytes(sk.chainKey)
    for (let i = sk.idx; i <= env.n; i++) {
      const [mk, next] = await kdfChain(chainKey)
      if (i === env.n) msgKey = mk
      else skipped[i] = b64u(mk)
      chainKey = next
    }
    // স্কিপ-লিস্ট অসীম বাড়তে দই না
    const keys = Object.keys(skipped)
    if (keys.length > 2000) for (const k of keys.slice(0, keys.length - 2000)) delete skipped[+k]
    await idb.put('senderKeys', `${chatId}:${senderId}`, { chainKey: b64u(chainKey), idx: env.n + 1, skipped })
  }

  const k = await crypto.subtle.importKey('raw', msgKey as unknown as BufferSource, 'AES-GCM', false, ['decrypt'])
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64uToBytes(env.iv) as BufferSource },
    k,
    b64uToBytes(env.ct) as BufferSource,
  )
  return JSON.parse(td.decode(plain))
}
