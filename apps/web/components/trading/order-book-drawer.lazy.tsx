'use client'
// components/trading/order-book-drawer.lazy.tsx
// Code-splits the inline order-book drawer. Drop-in for ./order-book-drawer.
//
// The board already renders it only for the expanded row
// (`clob && expandedId === o.id`), so nothing is mounted until someone opens
// a row — but it was still in /markets/[slug]'s first load, along with the
// depth table behind it. Nothing listens for an event here, so unlike the
// market drawer this needs no buffered intent: the parent's own guard is the
// trigger. Ruling A11.
import dynamic from 'next/dynamic'

export const OrderBookDrawer = dynamic(
  () => import('./order-book-drawer').then((m) => m.OrderBookDrawer),
  {
    ssr: false,
    loading: () => (
      <div
        className="skeleton mt-2 h-[200px] w-full rounded-md"
        role="status"
        aria-label="Loading order book…"
      />
    ),
  },
)
