'use client'

// components/trading/order-book-drawer.tsx
// ------------------------------------------------------------
// The inline accordion drawer PM expands under a clicked candidate row on an
// order-book (CLOB) market. Three tabs — Order Book / Graph / Resolution —
// built 1:1 to the measured ground truth in
// docs/design/PM-CLOB-DRAWER-MEASURED-2026-07.md:
//   • Order Book: the shared BookTable (asks red desc → Last/Spread → bids green
//     desc, dual %+¢, cumulative TOTAL, depth bars, Asks/Bids pills). Fetched +
//     polled via useClobBook (shared with the mobile MarketDrawer).
//   • Graph: the candidate's YES-probability history via PriceChart.
//   • Resolution: Propose-resolution CTA + View-details link (criteria).
import { useEffect, useState } from 'react'
import { PriceChart } from '@/components/markets/price-chart.lazy'
import { BookTable, useClobBook } from '@/components/trading/order-book-table'
import { IconRefresh } from '@/components/ui/icons'

type Tab = 'book' | 'graph' | 'resolution'

interface PricePoint {
  yes_price: number
  no_price: number
  volume_usd: number | null
  recorded_at: string | null
}

export function OrderBookDrawer({
  marketRef,
  optionId,
  side = 'yes',
  currentYes,
  volumeUsd,
  resolutionCriteria,
  resolvesAt,
}: {
  /** market slug or UUID for the API path. */
  marketRef: string
  optionId: string
  side?: 'yes' | 'no'
  currentYes?: number
  volumeUsd?: number
  resolutionCriteria?: string | null
  resolvesAt?: string | null
}) {
  const [tab, setTab] = useState<Tab>('book')
  const [series, setSeries] = useState<PricePoint[] | null>(null)
  // Which side's book is shown — flipped by the "TRADE YES/NO" header glyph (PM).
  const [bookSide, setBookSide] = useState<'yes' | 'no'>(side)

  // Poll the book only while the Order Book tab is visible (save requests + battery).
  const { book, loading, error: bookErr, reload } = useClobBook(marketRef, optionId, bookSide, tab === 'book')

  // Lazy-load the candidate's history the first time Graph is opened.
  useEffect(() => {
    if (tab !== 'graph' || series) return
    fetch(`/api/markets/${encodeURIComponent(marketRef)}/price-history?option=${optionId}&max_points=200`, {
      cache: 'no-store',
    })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setSeries((j.data ?? []) as PricePoint[]))
      .catch(() => setSeries([]))
  }, [tab, series, marketRef, optionId])

  const TABS: { key: Tab; label: string }[] = [
    { key: 'book', label: 'Order Book' },
    { key: 'graph', label: 'Graph' },
    { key: 'resolution', label: 'Resolution' },
  ]

  return (
    <div className="border-t border-hairline bg-surface px-4 py-3">
      {/* Tab bar + right chrome (Maker Rebate · Rewards · refresh · tick) */}
      <div className="flex items-center justify-between gap-3">
        <div role="tablist" aria-label="Candidate details" className="flex items-center gap-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              // PM parity (live-measured 2026-07-18): tabs are 14px/600, active
              // near-black, inactive muted #77808D that LIGHTENS to #AEB4BC on
              // hover (not darkens); 0.15s color transition; -0.09px tracking.
              className={`text-sm font-semibold tracking-[-0.09px] transition-colors duration-150 ${
                tab === t.key ? 'text-text-primary' : 'text-text-muted hover:text-[var(--ink-300)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* Right chrome. PM parity: Maker Rebate + Rewards are 14px/600, the
            tick is a 12px muted BORDERED chip (not plain text). */}
        <div className="flex items-center gap-3 text-sm font-semibold">
          <span className="flex items-center gap-1 text-amber" title="Maker rebate eligible">
            <span aria-hidden>🪙</span> Maker Rebate
          </span>
          <span className="text-pip-text">+ Rewards</span>
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

      {tab === 'book' && (
        <BookTable
          key={bookSide}
          book={book}
          loading={loading}
          error={bookErr}
          side={bookSide}
          onToggleSide={() => setBookSide((s) => (s === 'yes' ? 'no' : 'yes'))}
        />
      )}

      {tab === 'graph' && (
        <div className="pt-3">
          {series === null ? (
            <div className="h-40 animate-pulse rounded-lg bg-surface-2" />
          ) : series.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">No price history yet.</p>
          ) : (
            <PriceChart
              data={series}
              currentYes={currentYes}
              volumeUsd={volumeUsd}
              resolutionDate={resolvesAt ?? undefined}
            />
          )}
        </div>
      )}

      {tab === 'resolution' && (
        // PM parity: a "Propose resolution" outlined pill (left) + a
        // "View details ↗" link (right); criteria text sits below when present.
        <div className="pt-4">
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              className="rounded-[9px] border border-hairline px-3 py-1.5 text-sm font-semibold text-text-primary transition-colors hover:bg-surface-2"
            >
              Propose resolution
            </button>
            <a
              href="#resolution"
              className="inline-flex items-center gap-0.5 text-sm font-semibold text-pip-text transition-opacity hover:opacity-80"
            >
              View details <span aria-hidden>↗</span>
            </a>
          </div>
          {resolutionCriteria ? (
            <p className="mt-3 text-sm leading-relaxed text-text-secondary">{resolutionCriteria}</p>
          ) : (
            <p className="mt-3 text-sm text-text-muted">Resolution details will be published here.</p>
          )}
        </div>
      )}
    </div>
  )
}
