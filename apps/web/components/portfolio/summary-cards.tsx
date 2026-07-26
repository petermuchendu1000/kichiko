// components/portfolio/summary-cards.tsx
// KPI band for the portfolio: total value · unrealized P&L · today's P&L · cash.
// Signed figures are color-coded via --yes/--no and never rely on color alone
// (an explicit +/- sign carries the meaning too). Monospace numerics, Pip cards.
import { formatUSD, formatMoneyCompact } from '@/lib/utils'
import { IconWallet, IconPortfolio, IconTrendUp, IconTrendDown } from '@/components/ui/icons'

interface SummaryCardsProps {
  totalValue: number
  unrealizedPnl: number
  unrealizedPnlPct: number
  todayPnl: number
  cashUsd: number
}

function signClass(n: number) {
  if (n > 0) return 'text-yes'
  if (n < 0) return 'text-no'
  return 'text-text-primary'
}

// Compact magnitude keeps large KES balances inside the narrow KPI card; the
// full value is exposed via title on the element.
function signed(n: number) {
  return `${n >= 0 ? '+' : '-'}${formatMoneyCompact(n)}`
}

export function SummaryCards({
  totalValue,
  unrealizedPnl,
  unrealizedPnlPct,
  todayPnl,
  cashUsd,
}: SummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {/* Total value */}
      <div className="card p-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-muted">
          <IconPortfolio size={13} /> Total value
        </div>
        <p className="truncate font-mono text-2xl font-bold text-text-primary" title={formatUSD(totalValue)}>{formatMoneyCompact(totalValue)}</p>
        <p className="mt-1 text-xs text-text-muted">Holdings + cash</p>
      </div>

      {/* Unrealized P&L */}
      <div className="card p-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-muted">
          {unrealizedPnl >= 0 ? <IconTrendUp size={13} /> : <IconTrendDown size={13} />}
          Unrealized P&amp;L
        </div>
        <p className={`truncate font-mono text-2xl font-bold ${signClass(unrealizedPnl)}`} title={formatUSD(unrealizedPnl)}>
          {signed(unrealizedPnl)}
        </p>
        <p className={`mt-1 text-xs font-medium ${signClass(unrealizedPnl)}`}>
          {unrealizedPnl >= 0 ? '+' : ''}
          {(unrealizedPnlPct * 100).toFixed(2)}%
        </p>
      </div>

      {/* Today's P&L */}
      <div className="card p-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-muted">
          {todayPnl >= 0 ? <IconTrendUp size={13} /> : <IconTrendDown size={13} />}
          Today&apos;s P&amp;L
        </div>
        <p className={`truncate font-mono text-2xl font-bold ${signClass(todayPnl)}`} title={formatUSD(todayPnl)}>{signed(todayPnl)}</p>
        <p className="mt-1 text-xs text-text-muted">Since 00:00 UTC</p>
      </div>

      {/* Cash */}
      <div className="card p-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-muted">
          <IconWallet size={13} /> Cash
        </div>
        <p className="truncate font-mono text-2xl font-bold text-text-primary" title={formatUSD(cashUsd)}>{formatMoneyCompact(cashUsd)}</p>
        <p className="mt-1 text-xs text-text-muted">Available balance</p>
      </div>
    </div>
  )
}
