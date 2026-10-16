'use client'
// components/markets/market-comments.lazy.tsx
// Code-splits the Community section (Comments / Top holders / Positions /
// Activity). Drop-in for ./market-comments.
//
// WHY: it and its two children reach for the browser Supabase client — a
// realtime channel, comment inserts, likes — which puts ~66 kB of
// `@supabase/ssr` into /markets/[slug]'s first load. The section sits well
// below the fold, under the rules and the news, and nothing above it depends
// on it. Ruling A11; the chart next door has been split this way since the
// first pass.
//
// `ssr: false` is deliberate rather than incidental: comments are
// user-generated discussion, not content this page needs indexed, and the
// server render was costing a query per visit for a section most visitors
// never scroll to.
import dynamic from 'next/dynamic'

export const MarketComments = dynamic(
  () => import('./market-comments').then((m) => m.MarketComments),
  {
    ssr: false,
    // Reserves the section's approximate height so the FAQ below it does not
    // jump when the chunk lands.
    loading: () => (
      <div
        className="mt-8 animate-pulse rounded-lg"
        style={{ minHeight: 280, background: 'var(--surface-2)' }}
        role="status"
        aria-label="Loading community discussion…"
      />
    ),
  },
)
