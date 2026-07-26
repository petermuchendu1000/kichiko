// components/markets/market-activity.tsx
// Recent activity feed on the Pip system: custom icons only (no lucide) and
// design tokens throughout (no shadcn text-muted-foreground / text-foreground).
import { formatDistanceToNow } from 'date-fns'
import { cn } from '@/lib/utils'
import { IconTrendUp, IconTrendDown } from '@/components/ui/icons'
import { TraderNameLink } from '@/components/ui/trader-link'

interface ActivityItem {
  id: string
  user_id: string
  action: string
  amount_usd: number | null
  side: 'yes' | 'no' | null
  price: number | null
  created_at: string | null
  user?: {
    display_name: string | null
    username: string | null
  }
}

interface MarketActivityProps {
  activity: ActivityItem[]
}

export function MarketActivity({ activity }: MarketActivityProps) {
  if (!activity.length) {
    return (
      <p className="py-4 text-center text-sm text-text-muted">
        No activity yet — be the first to trade this market.
      </p>
    )
  }

  return (
    <div className="space-y-2.5">
      {activity.map((item) => {
        const isBuy = item.action === 'bet_yes' || item.action === 'bet_no'
        const isYes = item.side === 'yes'
        const displayName =
          item.user?.display_name || item.user?.username || `User…${item.user_id.slice(-4)}`

        return (
          <div key={item.id} className="flex items-center justify-between text-sm">
            <div className="flex min-w-0 items-center gap-2">
              {isBuy &&
                (isYes ? (
                  <IconTrendUp size={14} className="flex-none text-yes" />
                ) : (
                  <IconTrendDown size={14} className="flex-none text-no" />
                ))}
              <span className="truncate text-text-muted">
                <TraderNameLink id={item.user_id} name={displayName} className="inline max-w-none" />{' '}
                {isBuy
                  ? `bet ${isYes ? 'YES' : 'NO'} at ${item.price ? Math.round(item.price * 100) : '?'}%`
                  : item.action.replace(/_/g, ' ')}
              </span>
            </div>
            <div className="ml-2 flex flex-none items-center gap-3">
              {item.amount_usd && (
                <span className={cn('font-mono text-xs font-medium', isYes ? 'text-yes' : 'text-no')}>
                  ${item.amount_usd.toFixed(2)}
                </span>
              )}
              <span className="text-xs text-text-muted">
                {item.created_at
                  ? formatDistanceToNow(new Date(item.created_at), { addSuffix: true })
                  : ''}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
