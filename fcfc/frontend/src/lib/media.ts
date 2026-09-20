// R2 → ফেচ → ক্লায়েন্ট-সাইড ডিক্রিপ্ট → অবজেক্ট URL (ক্যাশে সহ)।
// সার্ভারে সব ফাইল এনক্রিপ্টেড থাকে; ব্রাউজারে দেখানোর আগে ডিক্রিপ্ট হয়।
import { api, mediaPath } from '../api/client'
import { decryptBlob, encryptBlob } from '../crypto/files'
import type { MediaMeta } from '../types'

const cache = new Map<string, string>()

export async function decryptedMediaUrl(media: MediaMeta): Promise<string> {
  const key = media.key
  if (cache.has(key)) return cache.get(key)!
  const res = await api(`/media/${mediaPath(key)}`, { raw: true })
  if (!res.ok) throw new Error(`media ${res.status}`)
  const enc = await res.blob()
  const plain = media.fileKey && media.iv ? await decryptBlob(enc, media.fileKey, media.iv) : enc
  const url = URL.createObjectURL(plain)
  cache.set(key, url)
  return url
}

export async function downloadMedia(media: MediaMeta) {
  const url = await decryptedMediaUrl(media)
  const a = document.createElement('a')
  a.href = url
  a.download = media.name || 'fcfc-file'
  a.click()
}

// আপলোড: এনক্রিপ্ট → মাল্টিপার্ট (বড় ফাইল) বা ছোট আপলোড
export async function uploadEncrypted(file: Blob, name: string, mime: string): Promise<MediaMeta> {
  const enc = await encryptBlob(file)

  if (enc.blob.size <= 20 * 1024 * 1024) {
    const res = await api('/media/upload/small', { method: 'POST', body: enc.blob, headers: { 'x-content-type': 'application/octet-stream' } })
    return { key: res.key, name, size: file.size, mime, iv: enc.iv, fileKey: enc.key }
  }

  // বড় ফাইল → মাল্টিপার্ট (পার্ট প্রতি 64MB, 2GB পর্যন্ত)
  const init = await api('/media/upload/init', { body: { name, mime, size: enc.blob.size, iv: enc.iv } })
  const PART = 64 * 1024 * 1024
  const parts: any[] = []
  let n = 1
  for (let off = 0; off < enc.blob.size; off += PART) {
    const chunk = enc.blob.slice(off, off + PART)
    const r = await api('/media/upload/part', {
      method: 'PUT',
      body: chunk,
      headers: { 'content-type': 'application/octet-stream', 'x-key': init.key, 'x-upload-id': init.uploadId, 'x-part-number': String(n) },
    })
    parts.push({ partNumber: n, etag: r.part?.etag })
    n++
  }
  await api('/media/upload/complete', { body: { key: init.key, uploadId: init.uploadId, parts } })
  return { key: init.key, name, size: file.size, mime, iv: enc.iv, fileKey: enc.key }
}

// চ্যাট-ওয়ালপেপার: ছবিকে কমপ্রেস করে ছোট ডেটা-URL বানাই।
// সার্ভার (D1) বড় স্ট্রিং রাখতে পারে না — ১২৮০px/JPEG-এ নামিয়ে ~90KB-এর
// নিচে রাখা হয়, নইলে আপলোড ব্যর্থ বা ট্রাঙ্কেটেড (ভাঙা) ওয়ালপেপার হতো।
export async function wallpaperDataUrl(file: Blob): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('ছবিটি পড়া যায়নি'))
      i.src = url
    })
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    let out = canvas.toDataURL('image/jpeg', 0.72)
    if (out.length > 90_000) out = canvas.toDataURL('image/jpeg', 0.5)
    if (out.length > 100_000) throw new Error('ছবিটি খুব বড় — একটু ছোট ছবি দিন')
    return out
  } finally {
    URL.revokeObjectURL(url)
  }
}
