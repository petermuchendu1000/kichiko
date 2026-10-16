'use client'

// components/trading/market-drawer.lazy.tsx
// ---------------------------------------------------------------------------
// Mounts the per-option drawer only once something asks for it.
//
// The drawer renders nothing until an `elopis:open-market` event arrives, but
// it is 322 lines and pulls the order-book panel and depth table behind it —
// all of it in /markets/[slug]'s first load, for a sheet most visitors never
// open (ruling A11).
//
// It cannot simply be `next/dynamic`'d, because it is the thing that listens
// for the event: lazy-mounting it would lose the tap that summoned it to a
// chunk fetch. So a small listener stands in its place and hands the intent
// to lib/open-market-bus.ts, which the real drawer claims when it mounts.
// Buffering rather than replaying on a timer, because a timer is a guess
// about when the chunk lands. Same shape as lib/auth-dialog-bus.ts.
import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import { OPEN_MARKET_EVENT, holdOpenMarketIntent, type OpenMarketDetail } from '@/lib/open-market-bus'
import type { Market, MarketOption } from '@/types'

const MarketDrawerBody = dynamic(
  () => import('./market-drawer').then((m) => m.MarketDrawer),
  { ssr: false },
)

export function MarketDrawer({ market, options }: { market: Market; options?: MarketOption[] | null }) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (armed) return
    const onOpen = (e: Event) => {
      holdOpenMarketIntent(((e as CustomEvent).detail || {}) as OpenMarketDetail)
      setArmed(true)
    }
    window.addEventListener(OPEN_MARKET_EVENT, onOpen as EventListener)
    return () => window.removeEventListener(OPEN_MARKET_EVENT, onOpen as EventListener)
  }, [armed])

  if (!armed) return null
  return <MarketDrawerBody market={market} options={options ?? undefined} />
}
