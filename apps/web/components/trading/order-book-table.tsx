'use client'

// components/trading/order-book-table.tsx
// ---------------------------------------------------------------------------
// Shared CLOB order-book depth table + fetch/poll hook. Used by BOTH the desktop
// inline OrderBookDrawer (Order Book tab) and the mobile MarketDrawer (Order
// Book section) so there is ONE order-book rendering and ONE data path — no
// drift between surfaces. Built to the measured ground truth in
// docs/design/PM-CLOB-DRAWER-MEASURED-2026-07.md: asks (red, desc) → Last/Spread
// divider → bids (green, desc), dual %+¢ price, cumulative TOTAL, left-anchored
// depth bars, Asks/Bids pills, TRADE YES heading. Live from GET
// /api/markets/[id]/book (public, cached ~2s), polled while visible.
import { useCallback, useEffect, useRef, useState } from 'react'
import { dualPriceLabel, formatCents, type BookLevel, type ClobBook } from '@/lib/clob'
import { formatVolume } from '@/lib/utils'
import { IconRefresh } from '@/components/ui/icons'

const num = (n: number, d = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })

/**
 * Fetch and (while `active`) 4s-poll one (market, option, side) CLOB book.
 * Returns the shaped book + loading/error + a manual `reload`. Polling stops
 * when `active` is false (tab hidden / section collapsed) to save requests.
 */
export function useClobBook(
  marketRef: string,
  optionId: string,
  side: 'yes' | 'no' = 'yes',
  active = true,
) {
  const [book, setBook] = useState<ClobBook | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const reload = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/markets/${encodeURIComponent(marketRef)}/book?option=${optionId}&side=${side}`,
        { cache: 'no-store' },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setBook((await res.json()) as ClobBook)
      setError(null)
    } catch {
      setError('Could not load the order book')
    } finally {
      setLoading(false)
    }
  }, [marketRef, optionId, side])

  useEffect(() => {
    if (!active) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    reload()
    pollRef.current = setInterval(reload, 4000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [active, reload])

  return { book, loading, error, reload }
}

/**
 * The depth table: asks (red desc) → Last/Spread → bids (green desc).
 *
 * PM parity — order-book SCROLL behavior (live-measured 2026-07-18, identical on
 * desktop and mobile): the full ladder renders inside a fixed **360px** window
 * (`max-h-[360px] overflow-y-auto`); the column header is **sticky (top:0)** and
 * stays pinned while the ladder scrolls; the Last/Spread divider is static and
 * scrolls with the content; on open the window **auto-scrolls to the inside**
 * (best ask/bid centered on the divider), so you scroll up for deeper asks and
 * down for deeper bids. Row pitch 36px ≈ 10 rows visible.
 */
export function BookTable({
  book,
  loading,
  error,
  side = 'yes',
  onToggleSide,
}: {
  book: ClobBook | null
  loading: boolean
  error: string | null
  /** Which side's book this is — sets the "Trade Yes/No" header label. */
  side?: 'yes' | 'no'
  /** When provided, the header label becomes a button that flips the book side
      (PM's desktop two-column glyph next to "TRADE YES"). */
  onToggleSide?: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const dividerRef = useRef<HTMLDivElement>(null)
  const centeredRef = useRef(false)

  const hasBook = !!book && (book.asks.length > 0 || book.bids.length > 0)

  // Center the divider once, on first load — never on later polls, so we don't
  // fight the user's manual scroll. (PM opens scrolled to the inside of the book.)
  useEffect(() => {
    if (!hasBook || centeredRef.current) return
    const c = scrollRef.current
    const d = dividerRef.current
    if (c && d) {
      c.scrollTop = Math.max(0, d.offsetTop - c.clientHeight / 2 + d.clientHeight / 2)
      centeredRef.current = true
    }
  }, [hasBook])

  if (loading && !book) return <div className="mt-3 h-64 animate-pulse rounded-lg bg-surface-2" />
  if (error) return <p className="py-8 text-center text-sm text-text-muted">{error}</p>
  if (!book) return null

  const asksDesc = [...book.asks].reverse() // worst→best so best sits by the spread
  if (!hasBook)
    return <p className="py-8 text-center text-sm text-text-muted">No open orders on this book yet.</p>

  return (
    // PM: fixed 360px scroll window over the full ladder (overflow-y auto).
    <div ref={scrollRef} className="relative mt-2 max-h-[360px] overflow-y-auto">
      {/* Sticky column header (PM: position:sticky; top:0 inside the scroll box —
          stays pinned as the ladder scrolls). Column gap tightens on mobile
          (gap-6) and matches the measured desktop spacing (gap-10) at sm+. */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-surface px-1 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        {/* PM shows a "TRADE YES/NO" heading + a small two-column layout glyph.
            When onToggleSide is set the glyph flips the book side (PM desktop). */}
        {onToggleSide ? (
          <button
            type="button"
            onClick={onToggleSide}
            aria-label={`Show the ${side === 'yes' ? 'No' : 'Yes'} book`}
            className="flex items-center gap-1 uppercase transition-colors hover:text-text-primary"
          >
            <span>Trade {side === 'yes' ? 'Yes' : 'No'}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <rect x="3" y="4" width="7" height="16" rx="1" />
              <rect x="14" y="4" width="7" height="16" rx="1" />
            </svg>
          </button>
        ) : (
          <span className="flex items-center gap-1">
            <span>Trade {side === 'yes' ? 'Yes' : 'No'}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <rect x="3" y="4" width="7" height="16" rx="1" />
              <rect x="14" y="4" width="7" height="16" rx="1" />
            </svg>
          </span>
        )}
        <div className="flex gap-6 sm:gap-10">
          <span className="w-16 text-right">Price</span>
          <span className="w-20 text-right">Shares</span>
          <span className="w-24 text-right">Total</span>
        </div>
      </div>

      {/* Asks (sell) — red, descending */}
      <div>
        {asksDesc.map((l, i) => (
          <BookRow key={`a${l.price}`} level={l} tone="no" pill={i === asksDesc.length - 1 ? 'Asks' : undefined} />
        ))}
      </div>

      {/* Last / Spread divider — static (scrolls with the ladder). */}
      <div
        ref={dividerRef}
        className="flex items-center justify-between px-1 py-2 text-xs font-semibold text-text-muted"
      >
        <span>
          Last:{' '}
          {book.last != null ? dualPriceLabel(book.last).percent : '-'}
        </span>
        <span>Spread: {book.spread != null ? formatCents(book.spread) : '—'}</span>
      </div>

      {/* Bids (buy) — green, descending */}
      <div>
        {book.bids.map((l, i) => (
          <BookRow key={`b${l.price}`} level={l} tone="yes" pill={i === 0 ? 'Bids' : undefined} />
        ))}
      </div>
    </div>
  )
}

/** One depth row: left-anchored tint bar (∝ cumulative depth) + dual price + shares + total. */
function BookRow({ level, tone, pill }: { level: BookLevel; tone: 'yes' | 'no'; pill?: 'Asks' | 'Bids' }) {
  const price = dualPriceLabel(level.price)
  const barColor = tone === 'yes' ? 'var(--yes-tint)' : 'var(--no-tint)'
  const priceColor = tone === 'yes' ? 'text-yes' : 'text-no'
  const pillBg = tone === 'yes' ? 'bg-yes' : 'bg-no'
  return (
    <div className="relative flex h-9 items-center justify-between overflow-hidden px-1">
      {/* depth bar */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0"
        style={{ width: `${Math.max(2, level.depthPct * 100)}%`, backgroundColor: barColor }}
      />
      <span className="relative z-[1] flex items-center gap-1.5">
        {pill && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${pillBg}`}>{pill}</span>
        )}
      </span>
      <div className="relative z-[1] flex items-center gap-6 tabular-nums sm:gap-10">
        <span className="w-16 text-right text-sm font-semibold">
          <span className={priceColor}>{price.percent}</span>
        </span>
        <span className="w-20 text-right text-sm text-text-primary">{num(level.size)}</span>
        <span className="w-24 text-right text-sm text-text-primary">{formatVolume(level.totalUsd)}</span>
      </div>
    </div>
  )
}

/**
 * Self-contained order-book panel (fetch + poll + table) for surfaces that do
 * not run their own polling — e.g. the mobile MarketDrawer's Order Book section.
 * Only mount this for pricing_engine='clob' markets.
 */
export function OrderBookPanel({
  marketRef,
  optionId,
  side: initialSide = 'yes',
  active = true,
  showSideToggle = false,
}: {
  marketRef: string
  optionId: string
  side?: 'yes' | 'no'
  active?: boolean
  /** Render PM's "Trade Yes / Trade No" text toggle above the book (mobile). */
  showSideToggle?: boolean
}) {
  const [side, setSide] = useState<'yes' | 'no'>(initialSide)
  const { book, loading, error, reload } = useClobBook(marketRef, optionId, side, active)
  return (
    <div>
      {showSideToggle && (
        // PM mobile: the book section opens with a Trade Yes / Trade No side
        // toggle (left) + refresh + tick chip (right).
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-4 text-sm font-semibold">
            {(['yes', 'no'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={`transition-colors duration-150 ${
                  side === s ? 'text-text-primary' : 'text-text-muted hover:text-[var(--ink-300)]'
                }`}
              >
                Trade {s === 'yes' ? 'Yes' : 'No'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Refresh order book"
              onClick={reload}
              className="text-text-muted transition-colors hover:text-text-primary"
            >
              <IconRefresh size={14} />
            </button>
            <span className="rounded border border-hairline px-1.5 py-0.5 text-xs font-medium text-text-muted">
              0.1%
            </span>
          </div>
        </div>
      )}
      {/* key on side so the scroll re-centers on the new book when toggled. */}
      <BookTable key={side} book={book} loading={loading} error={error} side={side} />
    </div>
  )
}
