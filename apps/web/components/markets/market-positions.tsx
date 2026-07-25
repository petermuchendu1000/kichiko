'use client'

// components/markets/market-positions.tsx
// ------------------------------------------------------------
// Market-wide "Positions" board (Polymarket parity — see the Positions tab on a
// Polymarket market page). Two mirrored columns (Yes | No) rank every holder by
// current position value; each row shows the trader, their average entry price,
// their current position value and the amount they've bought:
//
//   [avatar②] alwayslatetothe…               avg 52¢
//             US$867,185.62
//             US$6,499,177.16 bought
//
// Data comes from the market_positions() SECURITY DEFINER RPC (migration 028),
// which exposes only already-public position economics (direct reads of the
// positions table are blocked by RLS). Multi-outcome markets get an outcome
// selector that scopes the board to one option's Yes/No book.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { formatUSD } from '@/lib/utils'
import { traderName } from '@/lib/trader'
import { TraderAvatar } from '@/components/ui/trader-avatar'
import type { MarketOption } from '@/types'

interface PositionRow {
  user_id: string
  display_name: string | null
  username: string | null
  avatar_url: string | null
  joined_at: string | null
  side: 'yes' | 'no'
  shares: number
  current_value_usd: number | null
  total_invested_usd: number | null
  avg_entry_price: number | null
  side_rank: number
}

/** Polymarket-style average price in cents ("52¢", "1.7¢" for sub-dime). */
function avgCents(price: number | null): string {
  const c = (price ?? 0) * 100
  return `${c > 0 && c < 10 ? c.toFixed(1) : Math.round(c)}%`
}

function PositionRowItem({ row, isSelf }: { row: PositionRow; isSelf: boolean }) {
  const name = traderName(row, row.user_id)
  const tone = row.side === 'no' ? 'text-no' : 'text-yes'
  return (
    <li className="flex items-start gap-2.5 rounded-md py-2 transition-colors hover:bg-surface-2">
      <div className="relative flex-none">
        <TraderAvatar id={row.user_id} name={name} imageUrl={row.avatar_url} size={30} />
        <span
          className={`absolute -bottom-1 -right-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none text-white ring-2 ring-surface ${
            row.side === 'no' ? 'bg-no' : 'bg-yes'
          }`}
          aria-hidden
        >
          {row.side_rank}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <Link
            href={`/traders/${row.user_id}`}
            className="truncate text-sm font-medium text-text-primary underline-offset-2 hover:text-pip-text hover:underline focus:outline-none focus-visible:text-pip-text focus-visible:underline"
          >
            {name}
          </Link>
          <span className="flex-none text-xs text-text-muted">avg {avgCents(row.avg_entry_price)}</span>
        </div>
        {isSelf && (
          <span className="mt-0.5 inline-block rounded-pill bg-pip-100 px-1.5 py-px text-[10px] font-semibold text-pip-text">
            You
          </span>
        )}
        <p className={`mt-0.5 truncate text-sm font-semibold tabular-nums ${tone}`}>
          {formatUSD(row.current_value_usd ?? 0)}
        </p>
        <p className="truncate text-xs text-text-muted tabular-nums">
          {formatUSD(row.total_invested_usd ?? 0)} bought
        </p>
      </div>
    </li>
  )
}

function PositionColumn({ title, rows, selfId }: { title: string; rows: PositionRow[]; selfId?: string }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 border-b border-hairline pb-1.5">
        <h4 className="text-sm font-semibold text-text-primary">{title}</h4>
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-text-muted">No positions on this side yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((r) => (
            <PositionRowItem key={r.user_id} row={r} isSelf={r.user_id === selfId} />
          ))}
        </ul>
      )}
    </div>
  )
}

interface MarketPositionsProps {
  marketId: string
  options?: MarketOption[] | null
  resolutionType?: string | null
}

export function MarketPositions({ marketId, options, resolutionType }: MarketPositionsProps) {
  const { user } = useAuth()
  const supabase = useMemo(() => createClient(), [])
  const isMulti = resolutionType === 'multiple_choice' && !!options && options.length > 0
  const sortedOptions = useMemo(
    () => (options ? [...options].sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0)) : []),
    [options],
  )
  const [optionId, setOptionId] = useState<string | null>(isMulti ? sortedOptions[0]?.id ?? null : null)
  const [rows, setRows] = useState<PositionRow[] | null>(null)

  useEffect(() => {
    let alive = true
    setRows(null)
    supabase
      .rpc('market_positions' as never, {
        p_market_id: marketId,
        p_option_id: isMulti ? optionId : null,
        p_limit: 12,
      } as never)
      .then(({ data }) => {
        if (alive) setRows(((data as unknown) as PositionRow[]) || [])
      })
    return () => {
      alive = false
    }
  }, [marketId, optionId, isMulti, supabase])

  const yes = rows?.filter((r) => r.side === 'yes') ?? []
  const no = rows?.filter((r) => r.side === 'no') ?? []
  const empty = rows !== null && yes.length === 0 && no.length === 0

  return (
    <div>
      {isMulti && (
        <div className="mb-4">
          <label htmlFor="positions-outcome" className="sr-only">
            Choose outcome
          </label>
          <div className="relative inline-block">
            <select
              id="positions-outcome"
              value={optionId ?? ''}
              onChange={(e) => setOptionId(e.target.value)}
              className="input appearance-none pr-9 text-sm font-medium"
            >
              {sortedOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <svg
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-muted"
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
        </div>
      )}

      {rows === null ? (
        <PositionsLoading />
      ) : empty ? (
        <div className="py-8 text-center">
          <p className="text-sm text-text-muted">No positions yet.</p>
          <p className="mt-1 text-xs text-text-muted">
            Traders appear here ranked by position value as soon as they take a side.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:gap-x-8">
          <PositionColumn title="Yes" rows={yes} selfId={user?.id} />
          <PositionColumn title="No" rows={no} selfId={user?.id} />
        </div>
      )}
    </div>
  )
}

function PositionsLoading() {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:gap-x-8">
      {[0, 1].map((c) => (
        <div key={c} className="space-y-2">
          <div className="skeleton mb-3 h-4 w-16 rounded" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-2.5 py-2">
              <div className="skeleton h-[30px] w-[30px] flex-none rounded-full" />
              <div className="flex-1 space-y-1.5">
                <div className="skeleton h-3 w-24 rounded" />
                <div className="skeleton h-3 w-20 rounded" />
                <div className="skeleton h-3 w-28 rounded" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
