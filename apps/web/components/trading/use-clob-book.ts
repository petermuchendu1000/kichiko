'use client'

// components/trading/use-clob-book.ts
// ---------------------------------------------------------------------------
// The order-book DATA hooks, separated from the table that renders it.
//
// WHY IT IS ITS OWN MODULE
// `pm-ticket.tsx` needs `useClobBook` and `useIsDisplayed` to price a trade —
// it does not render a ladder. Importing them from order-book-table.tsx
// dragged BookTable and OrderBookPanel into the ticket's chunk, and the ticket
// is in /markets/[slug]'s first load. Same shape as `openAuthDialog` living
// with the 766-line dialog, and as calling `createClient()` during render
// (ruling A11): reach for a function, get a component tree.
import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from 'react'
import { bookPoller, EMPTY_SNAPSHOT } from '@/lib/book-poller'

/**
 * One (market, option, side) CLOB book, polled every 4s while `active`.
 * Every component asking for the same book shares one request and one snapshot
 * (lib/book-poller.ts); polls never overlap and pause in background tabs.
 */
export function useClobBook(
  marketRef: string,
  optionId: string,
  side: 'yes' | 'no' = 'yes',
  active = true,
) {
  const url = `/api/markets/${encodeURIComponent(marketRef)}/book?option=${optionId}&side=${side}`
  const live = active && !!optionId
  const subscribe = useCallback(
    (onChange: () => void) => (live ? bookPoller.subscribe(url, onChange) : () => {}),
    [live, url],
  )
  const snap = useSyncExternalStore(
    subscribe,
    () => bookPoller.getSnapshot(url),
    () => EMPTY_SNAPSHOT,
  )
  const reload = useCallback(() => bookPoller.reload(url), [url])
  return { book: snap.book, loading: snap.loading, error: snap.error, reload }
}

/**
 * False while `ref`'s element is not displayed (e.g. inside a `hidden lg:block`
 * wrapper on a phone), so a mounted-but-hidden component can stop polling.
 */
export function useIsDisplayed(ref: RefObject<HTMLElement | null>): boolean {
  const [shown, setShown] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const check = () => setShown(el.getClientRects().length > 0)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return shown
}
