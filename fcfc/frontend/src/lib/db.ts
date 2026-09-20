// IndexedDB র‍্যাপার — প্রাইভেট কী, র্যাচেট সেশন, ডিক্রিপ্টেড মেসেজ ইনডেক্স
// সব লোকালি থাকে; প্লেইনটেক্সট কখনো সার্ভারে যায় না।
const DB_NAME = 'fcfc'
const DB_VER = 1

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys')
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions')
      if (!db.objectStoreNames.contains('senderKeys')) db.createObjectStore('senderKeys')
      if (!db.objectStoreNames.contains('messages')) db.createObjectStore('messages', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('starred')) db.createObjectStore('starred')
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx(store: string, mode: IDBTransactionMode) {
  return open().then((db) => db.transaction(store, mode).objectStore(store))
}

export const idb = {
  async get<T = any>(store: string, key: IDBValidKey): Promise<T | undefined> {
    const s = await tx(store, 'readonly')
    return new Promise((res, rej) => {
      const r = s.get(key)
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
  },
  async put(store: string, key: IDBValidKey | null, value: any): Promise<void> {
    const s = await tx(store, 'readwrite')
    return new Promise((res, rej) => {
      const r = key === null ? s.put(value) : s.put(value, key)
      r.onsuccess = () => res()
      r.onerror = () => rej(r.error)
    })
  },
  async del(store: string, key: IDBValidKey): Promise<void> {
    const s = await tx(store, 'readwrite')
    return new Promise((res, rej) => {
      const r = s.delete(key)
      r.onsuccess = () => res()
      r.onerror = () => rej(r.error)
    })
  },
  async all<T = any>(store: string): Promise<T[]> {
    const s = await tx(store, 'readonly')
    return new Promise((res, rej) => {
      const r = s.getAll()
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
  },
  async allKeys(store: string): Promise<IDBValidKey[]> {
    const s = await tx(store, 'readonly')
    return new Promise((res, rej) => {
      const r = s.getAllKeys()
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
  },
}
