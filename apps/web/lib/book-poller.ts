// lib/book-poller.ts
// ------------------------------------------------------------
// One poller per order-book URL, shared by every component that shows it.
//
// The market page mounts the ticket (top of book for prices) and the order-book
// drawer (full ladder), which read the same /api/markets/[id]/book URL. Each used
// to run its own 4s setInterval, so one page made two or more requests per tick;
// the intervals also fired while a slow request was still pending (requests
// piled up), and kept running in background tabs. Here:
//   - subscribers of the same URL share one request and one snapshot;
//   - the next poll is scheduled only after the previous one settles;
//   - polling pauses while the document is hidden and refreshes on return;
//   - the last snapshot is kept, so reopening a book renders at once.

import type { ClobBook } from '@/lib/clob'

export interface BookSnapshot {
  book: ClobBook | null
  error: string | null
  loading: boolean
}

export const BOOK_POLL_MS = 4000
export const EMPTY_SNAPSHOT: BookSnapshot = Object.freeze({ book: null, error: null, loading: true })

interface Entry {
  snap: BookSnapshot
  fetchedAt: number
  listeners: Set<() => void>
  timer: ReturnType<typeof setTimeout> | null
  inflight: Promise<void> | null
}

export interface BookPollerDeps {
  fetch: (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>
  isHidden: () => boolean
  /** Registers a visibility-change callback once; returns nothing. */
  onVisibilityChange: (cb: () => void) => void
  now: () => number
  intervalMs?: number
}

export function createBookPoller(deps: BookPollerDeps) {
  const interval = deps.intervalMs ?? BOOK_POLL_MS
  const entries = new Map<string, Entry>()
  let visibilityHooked = false

  const entry = (url: string): Entry => {
    let e = entries.get(url)
    if (!e) {
      e = { snap: EMPTY_SNAPSHOT, fetchedAt: 0, listeners: new Set(), timer: null, inflight: null }
      entries.set(url, e)
    }
    return e
  }

  const clearTimer = (e: Entry) => {
    if (e.timer) clearTimeout(e.timer)
    e.timer = null
  }

  const schedule = (url: string, e: Entry) => {
    clearTimer(e)
    if (e.listeners.size === 0 || deps.isHidden()) return
    e.timer = setTimeout(() => void load(url), interval)
  }

  const set = (e: Entry, snap: BookSnapshot) => {
    e.snap = snap
    e.listeners.forEach((l) => l())
  }

  function load(url: string): Promise<void> {
    const e = entry(url)
    if (e.inflight) return e.inflight
    clearTimer(e)
    e.inflight = (async () => {
      try {
        const res = await deps.fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const book = (await res.json()) as ClobBook
        e.fetchedAt = deps.now()
        set(e, { book, error: null, loading: false })
      } catch {
        set(e, { book: e.snap.book, error: 'Could not load the order book', loading: false })
      } finally {
        e.inflight = null
        schedule(url, e)
      }
    })()
    return e.inflight
  }

  const isStale = (e: Entry) => deps.now() - e.fetchedAt >= interval

  const hookVisibility = () => {
    if (visibilityHooked) return
    visibilityHooked = true
    deps.onVisibilityChange(() => {
      entries.forEach((e, url) => {
        if (e.listeners.size === 0) return
        if (deps.isHidden()) clearTimer(e)
        else if (isStale(e)) void load(url)
        else schedule(url, e)
      })
    })
  }

  return {
    subscribe(url: string, listener: () => void): () => void {
      hookVisibility()
      const e = entry(url)
      e.listeners.add(listener)
      if (e.listeners.size === 1 && !e.inflight) {
        if (isStale(e) && !deps.isHidden()) void load(url)
        else schedule(url, e)
      }
      return () => {
        e.listeners.delete(listener)
        if (e.listeners.size === 0) clearTimer(e)
      }
    },
    getSnapshot(url: string): BookSnapshot {
      return entries.get(url)?.snap ?? EMPTY_SNAPSHOT
    },
    reload: load,
  }
}

const hasDocument = () => typeof document !== 'undefined'

/** The app-wide poller (browser only; on the server nothing subscribes). */
export const bookPoller = createBookPoller({
  fetch: (url) => fetch(url, { cache: 'no-store' }),
  isHidden: () => hasDocument() && document.visibilityState === 'hidden',
  onVisibilityChange: (cb) => {
    if (hasDocument()) document.addEventListener('visibilitychange', cb)
  },
  now: () => Date.now(),
})
