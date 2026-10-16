// lib/open-market-bus.ts
// ---------------------------------------------------------------------------
// The intent behind `elopis:open-market`, held until the drawer can take it.
//
// The drawer is mounted lazily (market-drawer.lazy.tsx), so the tap that
// summons it happens before its listener exists — one chunk fetch earlier.
// Replaying the event on a timer would be a guess about when the chunk lands;
// buffering is not. Same reasoning, and the same shape, as
// lib/auth-dialog-bus.ts.
//
// A third module rather than an export from either side, because the drawer
// and its lazy mount would otherwise import each other.

export const OPEN_MARKET_EVENT = 'elopis:open-market'

export interface OpenMarketDetail {
  marketId?: string
  optionId?: string
  side?: 'yes' | 'no'
  openSheet?: boolean
}

let pending: OpenMarketDetail | null = null

/** Remember an intent raised before the drawer existed. */
export function holdOpenMarketIntent(detail: OpenMarketDetail): void {
  pending = detail
}

/**
 * Take the held intent. Returns null once consumed, so a remount cannot
 * reopen the drawer on something the reader already dismissed.
 */
export function consumeOpenMarketIntent(): OpenMarketDetail | null {
  const d = pending
  pending = null
  return d
}
