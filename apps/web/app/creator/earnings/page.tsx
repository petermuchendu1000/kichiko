// app/creator/earnings/page.tsx — Creator reward earnings over time.
//
// WHERE CREATOR REWARDS COME FROM (verified against the live schema):
//   • PAID rewards are ledger entries in `transactions` with type = 'creator_reward'
//     (amount_usd credited to the creator's wallet). These are the authoritative,
//     settled earnings and drive the monthly time series. Read RLS-scoped by
//     user_id = auth.uid().
//   • ACCRUED rewards are derived, per market, as total_volume_usd × creator_reward_rate
//     (a real fraction stored on each market, e.g. 0.0025 = 0.25%). This is what the
//     trading volume has earned and is shown alongside the paid figure so a creator
//     can see accrual vs. settlement.
// No amounts, rates, or KES conversions are hardcoded: all *_usd values are true USD
// and rendered in KES via the canonical converter threaded with a LIVE rates map.
import { requireCreator } from '@/lib/creator/guard'
import { buildRatesMap } from '@/lib/currency'
import { kes, kes2 } from '@/lib/admin/money'
import { formatRewardPct } from '@/lib/admin/creators'
import {
  paidRewardUsd,
  accruedRewardUsd,
  rewardByMonth,
  marketAccruedRewardUsd,
  num,
  type CreatorMarketRow,
  type CreatorRewardTxnRow,
} from '@/lib/creator/earnings'
import {
  Kpi, KpiGrid, TableCard, Table, Th, Td, EmptyRow,
} from '@/components/admin/ui'
import { IconGift, IconCoins } from '@/components/ui/icons'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Creator Console · Earnings', robots: { index: false, follow: false } }

interface MarketRow extends CreatorMarketRow {
  title: string | null
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-KE', {
    year: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

export default async function CreatorEarningsPage() {
  const ctx = await requireCreator()
  const sb = ctx.supabase

  const [marketsRes, rewardsRes, ratesRes] = await Promise.all([
    sb
      .from('markets')
      .select('id, title, status, total_volume_usd, creator_reward_rate, unique_bettors, created_at')
      .eq('creator_id', ctx.user.id)
      .order('total_volume_usd', { ascending: false }),
    sb
      .from('transactions')
      .select('amount_usd, status, created_at, market_id')
      .eq('user_id', ctx.user.id)
      .eq('type', 'creator_reward')
      .order('created_at', { ascending: true }),
    sb.from('exchange_rates').select('from_currency, rate').eq('to_currency', 'USD'),
  ])

  const rates = buildRatesMap((ratesRes.data ?? []) as Array<{ from_currency: string; rate: number | string | null }>)
  const markets = (marketsRes.data ?? []) as MarketRow[]
  const rewardTxns = (rewardsRes.data ?? []) as CreatorRewardTxnRow[]

  const paid = paidRewardUsd(rewardTxns)
  const accrued = accruedRewardUsd(markets)
  const monthly = rewardByMonth(rewardTxns)

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid className="lg:grid-cols-2">
        <Kpi
          label="Reward earnings (paid)"
          value={kes(paid, rates)}
          sub={`${monthly.length} month${monthly.length === 1 ? '' : 's'} with payouts`}
          icon={<IconGift size={15} />}
        />
        <Kpi
          label="Reward accrued (from volume)"
          value={kes(accrued, rates)}
          sub="volume × reward rate across your markets"
          icon={<IconCoins size={15} />}
        />
      </KpiGrid>

      {/* Paid rewards over time */}
      <section aria-labelledby="earnings-monthly-heading" className="flex flex-col gap-3">
        <h2 id="earnings-monthly-heading" className="text-sm font-semibold text-[var(--text-secondary)]">
          Paid rewards by month
        </h2>
        <TableCard>
          <Table>
            <thead>
              <tr>
                <Th>Month</Th>
                <Th num>Payouts</Th>
                <Th num>Amount (KES)</Th>
              </tr>
            </thead>
            <tbody>
              {monthly.length === 0 ? (
                <EmptyRow colSpan={3}>
                  No reward payouts settled yet — rewards accrue from trading volume on your markets.
                </EmptyRow>
              ) : (
                monthly.map((row) => (
                  <tr key={row.month}>
                    <Td>{monthLabel(row.month)}</Td>
                    <Td num>{row.count.toLocaleString()}</Td>
                    <Td num>{kes2(row.usd, rates)}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </TableCard>
      </section>

      {/* Per-market accrual */}
      <section aria-labelledby="earnings-accrual-heading" className="flex flex-col gap-3">
        <h2 id="earnings-accrual-heading" className="text-sm font-semibold text-[var(--text-secondary)]">
          Accrued reward by market
        </h2>
        <TableCard>
          <Table>
            <thead>
              <tr>
                <Th>Market</Th>
                <Th num>Volume (KES)</Th>
                <Th num>Reward rate</Th>
                <Th num>Accrued (KES)</Th>
              </tr>
            </thead>
            <tbody>
              {markets.length === 0 ? (
                <EmptyRow colSpan={4}>You haven&apos;t created any markets yet.</EmptyRow>
              ) : (
                markets.map((m) => (
                  <tr key={m.id}>
                    <Td>
                      <span className="font-medium text-[var(--text-primary)]">{m.title ?? 'Untitled market'}</span>
                    </Td>
                    <Td num>{kes(m.total_volume_usd, rates)}</Td>
                    <Td num>{formatRewardPct(num(m.creator_reward_rate))}</Td>
                    <Td num>{kes2(marketAccruedRewardUsd(m), rates)}</Td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </TableCard>
      </section>
    </div>
  )
}
