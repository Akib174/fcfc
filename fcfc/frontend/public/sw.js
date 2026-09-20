/* fcfc service worker — অফলাইন ফলব্যাক + ওয়েব পুশ নোটিফিকেশন */
const CACHE = 'fcfc-v1'
const CORE = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

// নেটওয়ার্ক-ফার্স্ট, বিল্ট অ্যাসেট ক্যাশে সেভ; অফলাইনে অ্যাপ খোলা থাকবে
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (url.pathname.startsWith('/assets/') || url.pathname === '/' || url.pathname === '/index.html')) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(req, copy))
        }
        return res
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/index.html'))),
  )
})

// পুশ নোটিফিকেশন — অ্যাপ বন্ধ থাকলেও ডিভাইস ট্রে-তে দেখাবে
self.addEventListener('push', (e) => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch {}
  const title = data.title || 'fcfc'
  const options = {
    body: data.body || 'নতুন নোটিফিকেশন',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'fcfc',
    renotify: true,
    vibrate: [120, 60, 120],
    silent: !!data.silent,
    requireInteraction: false,
    data: data.data || {},
  }
  e.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const target = e.notification.data?.chatId ? `/?chat=${e.notification.data.chatId}` : '/'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
