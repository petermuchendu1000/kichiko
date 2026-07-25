'use client'

// components/profile/trader-portfolio.tsx
// ------------------------------------------------------------
// Trader-profile portfolio — Polymarket parity (docs/holder-page-pm-parity-spec.md):
//   • Positions / Activity underline tabs (16px/600, letter-spacing -0.18px).
//   • Active | Closed segmented control on an ink-50 track (h36, radius 7.2px,
//     equal halves on mobile), active = raised surface.
//   • Search field (h40, radius 9.2px, ink-50 fill, leading search icon).
//   • "Value" sort control, right-aligned.
//   • Position rows: market avatar + title + outcome chip (Yes/No + cents) +
//     shares, right-aligned value + signed P&L. Green #42C772 / red #E23939.
// Data: read-only trader_positions RPC + market_activity (public aggregates).
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { formatUSD } from '@/lib/utils'

interface PositionRow {
  position_id: string
  market_id: string
  market_slug: string
  market_title: string
  category: string
  option_label: string | null
  side: 'yes' | 'no'
  shares: number
  avg_entry_price: number
  current_price: number
  current_value_usd: number
  total_invested_usd: number
  unrealized_pnl_usd: number
  realized_pnl_usd: number
  total_payout_usd: number
  is_active: boolean
  is_won: boolean
  updated_at: string
}

type Status = 'active' | 'closed'
type Sort = 'value' | 'pnl'

const cents = (p: number) => `${Math.round(Number(p) * 100)}%`
const shares = (n: number) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 })

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="text-text-muted">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="m20 20-3.2-3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function OutcomeChip({ side, price }: { side: 'yes' | 'no'; price: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-pill px-1.5 py-px text-[11px] font-semibold"
      style={{
        background: side === 'no' ? 'var(--no-tint)' : 'var(--yes-tint)',
        color: side === 'no' ? 'var(--no-700)' : 'var(--yes-700)',
      }}
    >
      {side === 'no' ? 'No' : 'Yes'} {cents(price)}
    </span>
  )
}

function MarketAvatar({ title }: { title: string }) {
  // Deterministic gradient tile from the market title (PM shows a market
  // thumbnail; we render a stable placeholder tile when none is available).
  const hue = useMemo(() => {
    let h = 0
    for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) % 360
    return h
  }, [title])
  return (
    <span
      aria-hidden
      className="h-10 w-10 flex-none rounded-lg"
      style={{ background: `linear-gradient(135deg, hsl(${hue} 62% 52%), hsl(${(hue + 40) % 360} 62% 42%))` }}
    />
  )
}

function MarketCell({ row }: { row: PositionRow }) {
  const entry = row.current_price ?? row.avg_entry_price
  return (
    <div className="flex min-w-0 items-center gap-3">
      <MarketAvatar title={row.market_title} />
      <div className="min-w-0">
        <Link
          href={`/markets/${row.market_slug}`}
          className="line-clamp-1 text-sm font-medium text-text-primary hover:text-pip-text hover:underline"
        >
          {row.market_title}
        </Link>
        <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
          {row.option_label && <span className="truncate font-medium text-text-secondary">{row.option_label}</span>}
          <OutcomeChip side={row.side} price={entry} />
          <span className="tabular-nums">{shares(row.shares)} shares</span>
        </div>
      </div>
    </div>
  )
}

function Pnl({ value, base }: { value: number; base: number }) {
  const pct = base > 0 ? (value / base) * 100 : 0
  const pos = value >= 0
  return (
    <span className={`tabular-nums text-xs font-medium ${pos ? 'text-yes' : 'text-no'}`}>
      {pos ? '+' : '−'}{formatUSD(Math.abs(value))} ({pos ? '' : '−'}{Math.abs(pct).toFixed(2)}%)
    </span>
  )
}

// Mobile positions list — PM parity: stacked rows (NO horizontal scroll). Each
// row = avatar + title + outcome chip + shares on the left, value + signed P&L
// stacked on the right, all inside the viewport.
function MobilePositions({ rows, status }: { rows: PositionRow[]; status: Status }) {
  return (
    <ul className="divide-y divide-hairline sm:hidden">
      {rows.map((r) => (
        <li key={r.position_id} className="flex items-start gap-3 py-3">
          <MarketAvatar title={r.market_title} />
          <div className="min-w-0 flex-1">
            {status === 'closed' && (
              <span
                className="mb-1 inline-flex items-center rounded-pill px-2 py-0.5 text-[11px] font-semibold"
                style={{
                  background: r.is_won ? 'var(--yes-tint)' : 'var(--no-tint)',
                  color: r.is_won ? 'var(--yes-700)' : 'var(--no-700)',
                }}
              >
                {r.is_won ? 'Won' : 'Lost'}
              </span>
            )}
            <Link
              href={`/markets/${r.market_slug}`}
              className="line-clamp-2 text-sm font-medium leading-snug text-text-primary hover:text-pip-text hover:underline"
            >
              {r.market_title}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
              {r.option_label && <span className="truncate font-medium text-text-secondary">{r.option_label}</span>}
              <OutcomeChip side={r.side} price={r.current_price ?? r.avg_entry_price} />
              <span className="tabular-nums">{shares(r.shares)} shares</span>
            </div>
          </div>
          <div className="flex flex-none flex-col items-end text-right">
            <span className="text-sm font-semibold tabular-nums text-text-primary">
              {formatUSD(status === 'active' ? r.current_value_usd : r.total_payout_usd)}
            </span>
            <Pnl
              value={status === 'active' ? r.unrealized_pnl_usd : r.realized_pnl_usd}
              base={r.total_invested_usd}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

interface ActivityRow {
  id: string
  action: string
  amount_usd: number | null
  side: 'yes' | 'no' | null
  price: number | null
  created_at: string | null
  market?: { title: string | null; slug: string | null } | null
}

function ActivityPanel({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<ActivityRow[] | null>(null)
  useEffect(() => {
    let alive = true
    supabase
      .from('market_activity')
      .select('id, action, amount_usd, side, price, created_at, market:markets!market_activity_market_id_fkey(title, slug)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => { if (alive) setRows(((data as unknown) as ActivityRow[]) || []) })
    return () => { alive = false }
  }, [supabase, userId])

  if (rows === null) return <PortfolioSkeleton />
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-text-muted">No recent activity.</p>
  return (
    <ul className="divide-y divide-hairline">
      {rows.map((a) => {
        const verb = a.action?.replace(/_/g, ' ') || 'trade'
        return (
          <li key={a.id} className="flex items-center justify-between gap-3 py-3 text-sm">
            <div className="min-w-0">
              <span className="font-medium capitalize text-text-primary">{verb}</span>{' '}
              {a.market?.slug ? (
                <Link href={`/markets/${a.market.slug}`} className="text-text-secondary hover:text-pip-text hover:underline">
                  {a.market.title}
                </Link>
              ) : (
                <span className="text-text-secondary">{a.market?.title}</span>
              )}
            </div>
            <span className="flex-none tabular-nums text-text-muted">
              {a.amount_usd != null ? formatUSD(a.amount_usd) : ''}
              {a.created_at ? ` · ${new Date(a.created_at).toLocaleDateString()}` : ''}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export function TraderPortfolio({ userId }: { userId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [view, setView] = useState<'positions' | 'activity'>('positions')
  const [status, setStatus] = useState<Status>('active')
  const [sort, setSort] = useState<Sort>('value')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<PositionRow[] | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => setDebounced(query.trim()), 250)
    return () => { if (debounce.current) clearTimeout(debounce.current) }
  }, [query])

  const load = useCallback(() => {
    let alive = true
    setRows(null)
    supabase
      .rpc('trader_positions' as never, {
        p_user_id: userId,
        p_status: status,
        p_search: debounced || null,
        p_limit: 100,
      } as never)
      .then(({ data }) => {
        if (alive) setRows(((data as unknown) as PositionRow[]) || [])
      })
    return () => { alive = false }
  }, [supabase, userId, status, debounced])

  useEffect(() => { const c = load(); return c }, [load])

  const sorted = useMemo(() => {
    if (!rows) return null
    const copy = [...rows]
    copy.sort((a, b) =>
      sort === 'value'
        ? b.current_value_usd - a.current_value_usd
        : (b.realized_pnl_usd + b.unrealized_pnl_usd) - (a.realized_pnl_usd + a.unrealized_pnl_usd),
    )
    return copy
  }, [rows, sort])

  return (
    <div>
      {/* Tabs — underline style, 16px/600 */}
      <div role="tablist" aria-label="Portfolio view" className="mb-4 flex items-center gap-5 border-b border-hairline">
        {(['positions', 'activity'] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => setView(v)}
            className={`-mb-px border-b-2 pb-2.5 text-base capitalize transition-colors ${
              view === v
                ? 'border-text-primary font-semibold text-text-primary'
                : 'border-transparent font-semibold text-text-muted hover:text-text-secondary'
            }`}
            style={{ letterSpacing: '-0.18px' }}
          >
            {v}
          </button>
        ))}
      </div>

      {view === 'activity' ? (
        <ActivityPanel userId={userId} />
      ) : (
        <PositionsPanel
          status={status}
          setStatus={setStatus}
          sort={sort}
          setSort={setSort}
          query={query}
          setQuery={setQuery}
          sorted={sorted}
          debounced={debounced}
        />
      )}
    </div>
  )
}

interface PositionsPanelProps {
  status: Status
  setStatus: (s: Status) => void
  sort: Sort
  setSort: (fn: (s: Sort) => Sort) => void
  query: string
  setQuery: (s: string) => void
  sorted: PositionRow[] | null
  debounced: string
}

function PositionsPanel({ status, setStatus, sort, setSort, query, setQuery, sorted, debounced }: PositionsPanelProps) {
  return (
    <div>
      {/* Controls: Active|Closed segmented · search · sort */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div role="tablist" aria-label="Position status" className="inline-flex rounded-md bg-surface-2 p-1">
          {(['active', 'closed'] as Status[]).map((s) => (
            <button
              key={s}
              role="tab"
              aria-selected={status === s}
              onClick={() => setStatus(s)}
              className={`h-9 flex-1 rounded-[7.2px] px-4 text-sm font-semibold capitalize transition-colors sm:flex-none ${
                status === s ? 'bg-surface text-text-primary shadow-e1' : 'text-text-muted hover:text-text-secondary'
              }`}
              style={{ letterSpacing: '-0.09px' }}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:flex-none">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2">
              <SearchIcon />
            </span>
            <label htmlFor="pos-search" className="sr-only">Search positions</label>
            <input
              id="pos-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search positions…"
              className="h-10 w-full rounded-[9.2px] border-0 bg-surface-2 pl-11 pr-3 text-sm text-text-primary outline-none transition-shadow placeholder:text-text-muted focus:shadow-[0_0_0_2px_var(--pip-100)] sm:w-56"
            />
          </div>
          <button
            type="button"
            onClick={() => setSort((s) => (s === 'value' ? 'pnl' : 'value'))}
            className="flex h-10 flex-none items-center gap-1.5 whitespace-nowrap rounded-[9.2px] bg-surface-2 px-3.5 text-sm font-semibold text-text-primary transition-colors hover:text-pip-text"
            style={{ letterSpacing: '-0.09px' }}
            aria-label={`Sort by ${sort === 'value' ? 'value' : 'profit and loss'}`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {sort === 'value' ? 'Value' : 'Profit/Loss'}
          </button>
        </div>
      </div>

      {/* Table */}
      {sorted === null ? (
        <PortfolioSkeleton />
      ) : sorted.length === 0 ? (
        <p className="py-10 text-center text-sm text-text-muted">
          {debounced
            ? 'No positions match your search.'
            : status === 'active'
              ? 'No open positions.'
              : 'No settled positions yet.'}
        </p>
      ) : (
        <>
        <MobilePositions rows={sorted} status={status} />
        <div className="table-wrapper -mx-1 hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-[11px] font-medium uppercase tracking-wide text-text-muted">
                {status === 'active' ? (
                  <>
                    <th className="py-2 pl-1 pr-3 font-medium">Market</th>
                    <th className="px-3 py-2 text-right font-medium">Avg</th>
                    <th className="px-3 py-2 text-right font-medium">Current</th>
                    <th className="py-2 pl-3 pr-1 text-right font-medium">Value</th>
                  </>
                ) : (
                  <>
                    <th className="py-2 pl-1 pr-3 font-medium">Result</th>
                    <th className="px-3 py-2 font-medium">Market</th>
                    <th className="px-3 py-2 text-right font-medium">Total traded</th>
                    <th className="py-2 pl-3 pr-1 text-right font-medium">Amount won</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.position_id} className="border-b border-hairline align-middle">
                  {status === 'active' ? (
                    <>
                      <td className="py-3 pl-1 pr-3"><MarketCell row={r} /></td>
                      <td className="px-3 py-3 text-right tabular-nums text-text-secondary">{cents(r.avg_entry_price)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-text-primary">{cents(r.current_price)}</td>
                      <td className="py-3 pl-3 pr-1 text-right">
                        <div className="font-semibold tabular-nums text-text-primary">{formatUSD(r.current_value_usd)}</div>
                        <Pnl value={r.unrealized_pnl_usd} base={r.total_invested_usd} />
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-3 pl-1 pr-3">
                        <span
                          className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-semibold"
                          style={{
                            background: r.is_won ? 'var(--yes-tint)' : 'var(--no-tint)',
                            color: r.is_won ? 'var(--yes-700)' : 'var(--no-700)',
                          }}
                        >
                          {r.is_won ? 'Won' : 'Lost'}
                        </span>
                      </td>
                      <td className="px-3 py-3"><MarketCell row={r} /></td>
                      <td className="px-3 py-3 text-right tabular-nums text-text-secondary">{formatUSD(r.total_invested_usd)}</td>
                      <td className="py-3 pl-3 pr-1 text-right">
                        <div className="font-semibold tabular-nums text-text-primary">{formatUSD(r.total_payout_usd)}</div>
                        <Pnl value={r.realized_pnl_usd} base={r.total_invested_usd} />
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  )
}

function PortfolioSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="skeleton h-10 w-10 flex-none rounded-lg" />
          <div className="skeleton h-4 flex-1 rounded" />
          <div className="skeleton h-4 w-12 rounded" />
          <div className="skeleton h-4 w-16 rounded" />
        </div>
      ))}
    </div>
  )
}
