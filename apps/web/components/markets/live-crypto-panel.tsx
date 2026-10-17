'use client'

// components/markets/live-crypto-panel.tsx
// ------------------------------------------------------------
// The live half of "Movers & hot topics".
//
// WHY THIS, AND NOT ANOTHER RANKED LIST
// The slot held "Most traded", ranked by volume. On a book whose most recent
// fill was two months ago, every volume ranking is the same six markets in a
// different order — and it was literally the same six the hero rail already
// showed, which is duplication, not content. A panel that repeats its
// neighbour is worse than an empty one: it costs the reader a second look to
// learn nothing.
//
// The Bitcoin windows are the one surface here with data that moves whether or
// not anybody has traded: they open and close on a clock, every few minutes,
// priced off live BTC/USD. So this panel always has something true to say, and
// what it says changes while you watch it.
//
// It deliberately mirrors the left panel's shape — a short list of rows with a
// figure on the right — so the section reads as one thing rather than a list
// beside a widget.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Market } from '@/types'

/** "btc-up-down-15m-1792214336" -> "15M". The slug is the contract, not the title. */
function windowLabel(slug: string): string {
  const m = /^btc-up-down-(\d+[mh])-/i.exec(slug)
  return m ? m[1].toUpperCase() : 'LIVE'
}

/** mm:ss, or null once the window has closed. */
function countdown(closesAt: string, now: number): string | null {
  const left = Math.floor((new Date(closesAt).getTime() - now) / 1000)
  if (!Number.isFinite(left) || left <= 0) return null
  const m = Math.floor(left / 60)
  const s = left % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function LiveCryptoPanel({ markets }: { markets: Market[] }) {
  // One tick for the whole panel. The server renders a correct first frame
  // (the page is force-dynamic), so this only keeps it honest afterwards.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (markets.length === 0) return null

  return (
    <div className="market-card !p-0 overflow-hidden">
      <div className="flex items-center gap-2.5 px-4 py-3.5" style={{ borderBottom: '1px solid var(--hairline)' }}>
        <span className="flex h-7 w-7 items-center justify-center rounded-[var(--r-sm)] text-[13px] font-bold"
          style={{ background: 'var(--brass-100)', color: 'var(--brass-600)' }} aria-hidden>₿</span>
        <div className="leading-tight">
          <div className="flex items-center gap-2 text-[14px] font-bold" style={{ color: 'var(--text)' }}>
            Bitcoin, live
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--no-700)' }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--no)' }} aria-hidden />
              LIVE
            </span>
          </div>
          <div className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--text-3)' }}>
            Settles on the Coinbase price
          </div>
        </div>
      </div>

      <ul className="flex flex-col">
        {markets.map((m, i) => {
          const upPct = Math.round((m.yes_price ?? 0.5) * 100)
          // Before the first client tick `now` is null, so the row renders the
          // window label alone rather than a countdown computed against a
          // server clock the reader cannot see. No hydration mismatch, and no
          // number that is already wrong by the time it is painted.
          const left = now === null ? null : countdown(m.closes_at, now)
          const closed = now !== null && left === null
          return (
            <li key={m.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--hairline)' }}>
              <Link
                href={`/markets/${m.slug}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-2)]"
              >
                <span className="flex-none rounded-[var(--r-sm)] px-2 py-1 font-mono text-[12px] font-bold"
                  style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                  {windowLabel(m.slug)}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
                    Up or Down?
                  </span>
                  <span className="mt-0.5 block text-[11px] tabular-nums" style={{ color: closed ? 'var(--text-3)' : 'var(--text-2)' }}>
                    {closed ? 'Settling' : left ? `Closes in ${left}` : 'Open now'}
                  </span>
                </span>

                {/* The split, not just the Up figure: on a two-sided market the
                    other side is the same information and a reader should not
                    have to subtract. */}
                <span className="flex flex-none items-center gap-2">
                  <span className="hidden h-1.5 w-16 overflow-hidden rounded-full sm:block"
                    style={{ background: 'var(--no-100, var(--surface-2))' }} aria-hidden>
                    <span className="block h-full rounded-full" style={{ width: `${upPct}%`, background: 'var(--yes)' }} />
                  </span>
                  {/* "Up", not a bare figure.
                      The market page shows an IMPLIED chance computed from the
                      live BTC price against the strike; this is the book's own
                      Up price, which on an untraded window sits at 50. Both are
                      true and they are not the same number, so the column says
                      which one it is rather than letting a live countdown imply
                      the percentage is live too. */}
                  <span className="w-[62px] text-right font-mono text-[13px] font-bold tabular-nums" style={{ color: 'var(--text)' }}>
                    <span className="font-sans text-[11px] font-semibold" style={{ color: 'var(--text-3)' }}>Up </span>
                    {upPct}%
                  </span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
