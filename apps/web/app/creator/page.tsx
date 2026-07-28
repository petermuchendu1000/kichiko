// app/creator/page.tsx — Creator overview: headline KPIs for the authenticated creator.
//
// Every figure is DB-backed and read through the RLS-enforced session client, so
// a creator only ever sees their own rows:
//   • creator_profiles (user_id = auth.uid())  → tier + status + reward %
//   • markets          (creator_id = auth.uid()) → counts, volume, bettors
//   • transactions     (user_id = auth.uid(), type 'creator_reward') → paid rewards
// All *_usd amounts are true USD and are rendered in KES via the canonical
// converter (lib/admin/money.kes) threaded with a LIVE rates map from
// exchange_rates (buildRatesMap). No hardcoded amounts, rates, or KES peg.
import Link from 'next/link'
import { requireCreator } from '@/lib/creator/guard'
import { buildRatesMap } from '@/lib/currency'
import { kes } from '@/lib/admin/money'
import { formatRewardPct } from '@/lib/admin/creators'
import {
  summarizeCreatorOverview,
  type CreatorMarketRow,
  type CreatorRewardTxnRow,
} from '@/lib/creator/earnings'
import { Kpi, KpiGrid, Pill, toneFor, EmptyState } from '@/components/admin/ui'
import { IconMarkets, IconCoins, IconClock, IconGift } from '@/components/ui/icons'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Creator Console · Overview', robots: { index: false, follow: false } }

const STATUS_TONE = {
  active: 'green',
  suspended: 'amber',
  revoked: 'red',
} as const

export default async function CreatorOverviewPage() {
  const ctx = await requireCreator()
  const sb = ctx.supabase

  const [profileRes, marketsRes, rewardsRes, ratesRes] = await Promise.all([
    sb
      .from('creator_profiles')
      .select('tier, reward_pct, status, max_open_markets, auto_publish')
      .eq('user_id', ctx.user.id)
      .maybeSingle(),
    sb
      .from('markets')
      .select('id, status, total_volume_usd, creator_reward_rate, unique_bettors, created_at')
      .eq('creator_id', ctx.user.id),
    sb
      .from('transactions')
      .select('amount_usd, status, created_at, market_id')
      .eq('user_id', ctx.user.id)
      .eq('type', 'creator_reward'),
    sb.from('exchange_rates').select('from_currency, rate').eq('to_currency', 'USD'),
  ])

  const rates = buildRatesMap((ratesRes.data ?? []) as Array<{ from_currency: string; rate: number | string | null }>)
  const markets = (marketsRes.data ?? []) as CreatorMarketRow[]
  const rewardTxns = (rewardsRes.data ?? []) as CreatorRewardTxnRow[]
  const profile = profileRes.data
  const s = summarizeCreatorOverview(markets, rewardTxns)

  return (
    <div className="flex flex-col gap-6">
      {/* Creator status band */}
      <section className="admin-panel flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-[var(--text-secondary)]">Creator status</span>
          {profile ? (
            <>
              <Pill tone={toneFor(profile.status, STATUS_TONE, 'neutral')} dot>
                {profile.status ?? 'unknown'}
              </Pill>
              {profile.tier && (
                <Pill tone="violet">{String(profile.tier)} tier</Pill>
              )}
              <span className="text-xs text-[var(--text-muted)]">
                Reward rate {formatRewardPct(Number(profile.reward_pct ?? 0))}
                {profile.max_open_markets != null && <> · Max open {profile.max_open_markets}</>}
              </span>
            </>
          ) : (
            <span className="text-xs text-[var(--text-muted)]">
              No creator profile on file — reward rates are applied per market.
            </span>
          )}
        </div>
        <Link href="/creator/markets" className="text-sm font-medium text-[var(--pip-500)] hover:underline">
          View my markets →
        </Link>
      </section>

      {/* Headline KPIs */}
      <KpiGrid>
        <Kpi
          label="Markets created"
          value={s.totalMarkets.toLocaleString()}
          sub={`${s.draftMarkets} draft · ${s.resolvedMarkets} resolved`}
          icon={<IconMarkets size={15} />}
          href="/creator/markets"
        />
        <Kpi
          label="Active markets"
          value={s.activeMarkets.toLocaleString()}
          sub="live and trading"
          icon={<IconMarkets size={15} />}
        />
        <Kpi
          label="Pending review"
          value={s.pendingMarkets.toLocaleString()}
          sub={s.pendingMarkets > 0 ? 'awaiting approval' : 'queue clear'}
          icon={<IconClock size={15} />}
          tone={s.pendingMarkets > 0 ? 'attention' : 'default'}
        />
        <Kpi
          label="Total volume"
          value={kes(s.totalVolumeUsd, rates)}
          sub={`${s.totalBettors.toLocaleString()} bettors across your markets`}
          icon={<IconCoins size={15} />}
        />
      </KpiGrid>

      {/* Reward earnings */}
      <KpiGrid className="lg:grid-cols-2">
        <Kpi
          label="Reward earnings (paid)"
          value={kes(s.paidRewardUsd, rates)}
          sub="settled to your wallet"
          icon={<IconGift size={15} />}
          href="/creator/earnings"
        />
        <Kpi
          label="Reward accrued (from volume)"
          value={kes(s.accruedRewardUsd, rates)}
          sub="earned by trading volume × reward rate"
          icon={<IconGift size={15} />}
          href="/creator/earnings"
        />
      </KpiGrid>

      {s.totalMarkets === 0 && (
        <EmptyState
          icon={<IconMarkets size={18} />}
          title="You haven't created any markets yet"
          description="Once you author a prediction market it will appear here with its live volume and reward earnings."
        />
      )}
    </div>
  )
}
