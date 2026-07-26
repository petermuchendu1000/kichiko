'use client'

// components/trading/position-summary.tsx
// ------------------------------------------------------------
// Real-time P&L context for the market detail page. Shows the signed-in user's
// open position in THIS market, marked-to-market against the live price so the
// trader always sees current exposure and unrealized P&L before they add to it.
//
// Positions are USD-denominated (place_bet settles in USD), so figures are shown
// in USD to stay unambiguous. Refreshes on mount and whenever the order ticket
// dispatches `kichiko:bet-placed`.
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { createClient } from '@/lib/supabase/client'
import { formatUSD } from '@/lib/utils'
import type { Market, MarketOption, Position } from '@/types'
import { IconPortfolio, IconTrendUp, IconTrendDown } from '@/components/ui/icons'

interface PositionSummaryProps {
  market: Market
  /** Options for multiple_choice markets (used to label + price option positions). */
  options?: MarketOption[]
}

export function PositionSummary({ market, options }: PositionSummaryProps) {
  const { user } = useAuth()
  const [positions, setPositions] = useState<Position[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    if (!user?.id) {
      setPositions([])
      setLoaded(true)
      return
    }
    const supabase = createClient()
    const { data } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', user.id)
      .eq('market_id', market.id)
      .eq('is_active', true)
      .gt('shares', 0)
    setPositions((data as Position[]) ?? [])
    setLoaded(true)
  }, [user?.id, market.id])

  useEffect(() => {
    void load()
  }, [load])

  // Re-fetch after the order ticket confirms a fill.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { marketId?: string } | undefined
      if (!detail?.marketId || detail.marketId === market.id) void load()
    }
    window.addEventListener('kichiko:bet-placed', handler)
    return () => window.removeEventListener('kichiko:bet-placed', handler)
  }, [load, market.id])

  if (!loaded || !user || positions.length === 0) return null

  return (
    <div className="card p-4">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-secondary">
        <span className="flex h-6 w-6 items-center justify-center rounded-sm bg-pip-100 text-pip-500">
          <IconPortfolio size={14} />
        </span>
        Your position
      </h2>

      <div className="space-y-3">
        {positions.map((pos) => {
          // Option positions price against their live option probability; binary
          // positions against the market's yes/no price.
          const option = pos.market_option_id
            ? options?.find((o) => o.id === pos.market_option_id)
            : undefined
          const livePrice = option
            ? option.price
            : pos.side === 'no'
              ? market.no_price
              : market.yes_price
          const currentValue = pos.shares * livePrice
          const unrealized = currentValue - pos.total_invested_usd
          const up = unrealized >= 0
          const pnlPct =
            pos.total_invested_usd > 0 ? (unrealized / pos.total_invested_usd) * 100 : 0

          return (
            <div
              key={pos.id}
              className="rounded-md border border-hairline bg-surface-2 p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                {option ? (
                  <span className="badge badge-muted max-w-[10rem] truncate" title={option.label}>
                    {option.label}
                  </span>
                ) : (
                  <span
                    className={`badge ${pos.side === 'yes' ? 'badge-green' : 'badge-red'}`}
                  >
                    {(pos.side ?? 'yes').toUpperCase()}
                  </span>
                )}
                <span
                  className={`inline-flex items-center gap-1 font-mono text-sm font-bold ${
                    up ? 'text-yes' : 'text-no'
                  }`}
                  aria-live="polite"
                >
                  {up ? <IconTrendUp size={13} /> : <IconTrendDown size={13} />}
                  {up ? '+' : ''}
                  {formatUSD(unrealized)}
                  <span className="text-xs font-medium opacity-70">
                    ({up ? '+' : ''}
                    {pnlPct.toFixed(1)}%)
                  </span>
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <div className="flex justify-between">
                  <dt className="text-text-muted">Shares</dt>
                  <dd className="font-mono text-text-primary">{pos.shares.toFixed(2)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">Avg entry</dt>
                  <dd className="font-mono text-text-primary">
                    {Math.round(pos.avg_entry_price * 100)}&#162;
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">Invested</dt>
                  <dd className="font-mono text-text-primary">
                    {formatUSD(pos.total_invested_usd)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-text-muted">Value</dt>
                  <dd className="font-mono text-text-primary">{formatUSD(currentValue)}</dd>
                </div>
              </dl>
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-text-muted">
        Marked to the live market price. Final settlement is at resolution.
      </p>
    </div>
  )
}
