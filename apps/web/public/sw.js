/* Kichiko service worker — app-shell & static asset caching.
 *
 * Strategy (mobile-first, low-bandwidth EA networks):
 *   - Static build assets (/_next/static, fonts, icons): cache-first (immutable,
 *     content-hashed — safe to serve from cache indefinitely).
 *   - Images: stale-while-revalidate (fast repeat views, refresh in background).
 *   - Navigations (HTML): network-first with an offline fallback page.
 *   - Everything under /api and /auth: NETWORK-ONLY, never cached (auth/RLS/
 *     money paths must never be served stale or to the wrong user).
 *
 * Cache is versioned; bumping VERSION on deploy evicts old entries. skipWaiting
 * + clients.claim make a new SW take over promptly.
 */
const VERSION = 'v1'
const STATIC_CACHE = `mp-static-${VERSION}`
const IMAGE_CACHE = `mp-images-${VERSION}`
const SHELL_CACHE = `mp-shell-${VERSION}`
const OFFLINE_URL = '/offline'

const PRECACHE = [OFFLINE_URL, '/manifest.json', '/favicon.svg', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      await cache.addAll(PRECACHE).catch(() => {})
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      const keep = new Set([STATIC_CACHE, IMAGE_CACHE, SHELL_CACHE])
      await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

function isStaticAsset(url) {
  return url.pathname.startsWith('/_next/static/') || /\.(?:css|js|woff2?|ttf|otf)$/.test(url.pathname)
}
function isImage(url) {
  return /\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico)$/.test(url.pathname) || url.pathname.startsWith('/_next/image')
}
function isNeverCache(url) {
  return url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  // Only handle same-origin requests.
  if (url.origin !== self.location.origin) return

  // Auth / API / money paths: always go to the network, never cache.
  if (isNeverCache(url)) return

  // Static, content-hashed assets: cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) cache.put(req, res.clone())
        return res
      }),
    )
    return
  }

  // Images: stale-while-revalidate.
  if (isImage(url)) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const hit = await cache.match(req)
        const network = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone())
            return res
          })
          .catch(() => hit)
        return hit || network
      }),
    )
    return
  }

  // Navigations: network-first, fall back to the offline shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req)
        } catch {
          const cache = await caches.open(SHELL_CACHE)
          return (await cache.match(OFFLINE_URL)) || Response.error()
        }
      })(),
    )
  }
})
