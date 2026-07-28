// app/marketer/page.tsx — Marketer overview: headline KPIs + plan status.
//
// All data is DB-backed and RLS-scoped to the signed-in marketer via
// ctx.supabase. Money columns are stored in USD and rendered in KES at the LIVE
// exchange_rates rate (fetchRatesMap → kes helper). Nothing here is hardcoded.
import Link from 'next/link'
import { requireMarketer } from '@/lib/marketer/guard'
import { buildRatesMap } from '@/lib/currency'
import { kes } from '@/lib/admin/money'
import { describePlan } from '@/lib/admin/marketers'
import { summarizeReferrals, summarizeCommissions, type ReferralRow, type PayoutItemRow } from '@/lib/marketer/console'
import { Kpi, KpiGrid, Panel, PanelHead, PanelBody, Pill, toneFor, DefinitionList, Def } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'

const STATUS_TONE = { active: 'green', suspended: 'amber', revoked: 'red' } as const

export default async function MarketerOverviewPage() {
  const ctx = await requireMarketer()
  const uid = ctx.user.id

  const [ratesRes, profileRes, referralsRes, payoutsRes] = await Promise.all([
    ctx.supabase.from('exchange_rates').select('from_currency, rate').eq('to_currency', 'USD'),
    ctx.supabase
      .from('marketer_profiles')
      .select('tracking_code, plan_key, commission_plan, hold_days, status, created_at')
      .eq('user_id', uid)
      .maybeSingle(),
    ctx.supabase
      .from('referrals')
      .select('status, qualified_at, created_at')
      .eq('referrer_id', uid),
    ctx.supabase
      .from('payout_items')
      .select('run_id, amount_usd, status, created_at')
      .eq('user_id', uid),
  ])

  const rates = buildRatesMap((ratesRes.data as { from_currency: string; rate: number | string | null }[]) ?? [])
  const profile = profileRes.data as
    | { tracking_code: string | null; plan_key: string | null; commission_plan: unknown; hold_days: number | null; status: string | null; created_at: string }
    | null
  const referrals = (referralsRes.data ?? []) as ReferralRow[]
  const payouts = (payoutsRes.data ?? []) as PayoutItemRow[]

  const ref = summarizeReferrals(referrals)
  const commission = summarizeCommissions(payouts)
  const status = profile?.status ?? null

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="kpis-heading">
        <h2 id="kpis-heading" className="sr-only">Key figures</h2>
        <KpiGrid>
          <Kpi label="Total referrals" value={ref.total.toLocaleString()} sub={`${ref.pending.toLocaleString()} pending`} href="/marketer/referrals" />
          <Kpi label="Active referrals" value={ref.active.toLocaleString()} sub="Qualified / converted" href="/marketer/referrals" />
          <Kpi label="Pending commission" value={kes(commission.pendingUsd, rates)} sub="Awaiting payout" tone={commission.pendingUsd > 0 ? 'attention' : 'default'} href="/marketer/commissions" />
          <Kpi label="Paid commission" value={kes(commission.paidUsd, rates)} sub="Disbursed to date" href="/marketer/commissions" />
        </KpiGrid>
      </section>

      <Panel>
        <PanelHead
          title="Your commission plan"
          description="The plan your commissions are computed against."
          actions={
            status ? (
              <Pill tone={toneFor(status, STATUS_TONE as unknown as Record<string, 'green' | 'amber' | 'red'>)} dot>
                {status}
              </Pill>
            ) : undefined
          }
        />
        <PanelBody>
          {profile ? (
            <DefinitionList>
              <Def label="Tracking code">
                <span className="font-mono">{profile.tracking_code ?? '—'}</span>
              </Def>
              <Def label="Plan">{profile.plan_key ?? '—'}</Def>
              <Def label="Terms">{describePlan(profile.commission_plan)}</Def>
              <Def label="Hold period">
                {typeof profile.hold_days === 'number' ? `${profile.hold_days} days` : '—'}
              </Def>
              <Def label="Partner since">
                {profile.created_at ? new Date(profile.created_at).toLocaleDateString() : '—'}
              </Def>
              <Def label="Total commission">{kes(commission.totalUsd, rates)}</Def>
            </DefinitionList>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">
              No marketer profile is linked to your account yet. If you believe this is an error,
              please contact support or check your{' '}
              <Link href="/settings" className="text-[var(--pip-500)] hover:underline">account settings</Link>.
            </p>
          )}
        </PanelBody>
      </Panel>
    </div>
  )
}
