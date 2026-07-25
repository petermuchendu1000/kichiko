// app/admin/marketers/[id]/page.tsx — Marketer detail with live commission preview.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { fetchMarketerAttribution, commissionUsd, normalizePlan, describePlan } from '@/lib/admin/marketers'
import { defaultPeriod } from '@/lib/admin/payouts'
import { ProfileStatusBadge } from '@/components/admin/growth/Badges'
import { MarketerStatusActions, RegenCodeButton, MarketerPlanForm } from '@/components/admin/growth/MarketerActions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Marketer' }

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

export default async function MarketerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requirePageCapability('marketers:manage')
  const sb = ctx.supabase

  const { data: marketer } = await sb
    .from('marketer_profiles')
    .select('user_id, tracking_code, plan_key, commission_plan, hold_days, status, suspended_reason, created_at, profiles!marketer_profiles_user_id_fkey(username, display_name, country_code, referral_count)')
    .eq('user_id', id)
    .single()
  if (!marketer) notFound()

  const p = marketer.profiles as unknown as { username: string | null; display_name: string | null; country_code: string | null; referral_count: number | null } | null
  const plan = normalizePlan(marketer.commission_plan)

  // Live preview for the default (previous-month) period + lifetime.
  const period = defaultPeriod()
  const [periodAttr, lifetimeAttr] = await Promise.all([
    fetchMarketerAttribution(sb, id, period.start, period.end + 'T23:59:59Z'),
    fetchMarketerAttribution(sb, id),
  ])
  const periodCommission = commissionUsd(plan, periodAttr.activations, periodAttr.revenueBaseUsd)
  const lifetimeCommission = commissionUsd(plan, lifetimeAttr.activations, lifetimeAttr.revenueBaseUsd)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/marketers" className="text-sm text-muted-foreground hover:underline">← Marketers</Link>
        <h1 className="text-2xl font-black">{p?.username ?? id.slice(0, 8)}</h1>
        <ProfileStatusBadge status={marketer.status} />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <span>{p?.display_name}</span>
        {p?.country_code && <span>· {p.country_code}</span>}
        <span>· Tracking <span className="font-mono text-foreground">{marketer.tracking_code}</span></span>
        <span>· {describePlan(plan)}</span>
        <Link href={`/admin/users/${id}`} className="text-primary hover:underline">View user →</Link>
      </div>
      {marketer.suspended_reason && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
          {marketer.status}: {marketer.suspended_reason}
        </div>
      )}

      <div className="card-grid grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Referred users" value={lifetimeAttr.referredUsers.toLocaleString()} hint={`${p?.referral_count ?? 0} on profile`} />
        <Stat label="Activations (lifetime)" value={lifetimeAttr.activations.toLocaleString()} hint="referred users with a deposit" />
        <Stat label="Revenue base (lifetime)" value={`$${lifetimeAttr.revenueBaseUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} hint="platform fees from referred bets" />
      </div>

      <section className="rounded-xl border border-primary/30 bg-primary/5 p-4">
        <h3 className="text-sm font-semibold">Commission preview</h3>
        <p className="text-xs text-muted-foreground">Estimated from current plan &amp; attribution. Actual accrual is computed at payout time.</p>
        <div className="card-grid mt-3 grid gap-4 sm:grid-cols-2">
          <Stat label={`Previous month (${period.start} → ${period.end})`} value={`$${periodCommission.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} hint={`${periodAttr.activations} activations · $${periodAttr.revenueBaseUsd.toFixed(2)} base`} />
          <Stat label="Lifetime estimate" value={`$${lifetimeCommission.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <RegenCodeButton userId={id} />
        <MarketerStatusActions userId={id} status={marketer.status} />
      </div>

      <MarketerPlanForm userId={id} current={{ model: plan.model, cpa_usd: plan.cpa_usd, revshare_pct: plan.revshare_pct, hold_days: plan.hold_days ?? 0 }} />
    </div>
  )
}
