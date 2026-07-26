// app/admin/marketers/campaigns/page.tsx — Promo campaign management.
import Link from 'next/link'
import { kes } from '@/lib/admin/money'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { budgetUtilisation, campaignEligibility, type CampaignLike } from '@/lib/admin/campaigns'
import { describePlan } from '@/lib/admin/marketers'
import { CampaignStatusBadge, KindBadge } from '@/components/admin/growth/Badges'
import { CampaignCreate, CampaignStatusActions } from '@/components/admin/growth/CampaignForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Campaigns' }

export default async function CampaignsPage() {
  const ctx = await requirePageCapability('marketers:manage')
  const sb = ctx.supabase

  const [{ data: campaigns }, { data: plans }] = await Promise.all([
    sb
      .from('campaigns')
      .select('id, code, label, kind, value_pct, max_value_usd, budget_usd, spent_usd, max_redemptions, redemption_count, per_user_limit, starts_at, ends_at, status, created_at')
      .order('created_at', { ascending: false })
      .limit(200),
    sb.from('commission_plans').select('key, label, plan, is_active').order('key'),
  ])

  const now = new Date()

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-3">
        <Link href="/admin/marketers" className="text-sm text-muted-foreground hover:underline">← Marketers</Link>
        <h1 className="text-2xl font-black">Campaigns</h1>
      </div>

      <CampaignCreate />

      <section className="table-wrapper overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="px-3 py-2">Code</th><th className="px-3 py-2">Type</th><th className="px-3 py-2 text-right">Value</th><th className="px-3 py-2 text-right">Budget</th><th className="px-3 py-2 text-right">Redemptions</th><th className="px-3 py-2">Window</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {(campaigns ?? []).length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No campaigns yet.</td></tr>}
            {(campaigns ?? []).map((c) => {
              const util = budgetUtilisation(c as CampaignLike)
              const elig = campaignEligibility(c as CampaignLike, now)
              return (
                <tr key={c.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2"><span className="font-mono font-semibold">{c.code}</span><div className="text-xs text-muted-foreground">{c.label}</div></td>
                  <td className="px-3 py-2"><KindBadge kind={c.kind} /></td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.value_pct}%{c.max_value_usd != null ? <div className="text-xs text-muted-foreground">≤ {kes(c.max_value_usd)}</div> : null}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.budget_usd == null ? <span className="text-muted-foreground">∞</span> : <>{kes(c.spent_usd)} / {kes(c.budget_usd)}<div className="mt-1 h-1 w-20 overflow-hidden rounded bg-muted"><div className="h-full bg-primary" style={{ width: `${Math.round(util * 100)}%` }} /></div></>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.redemption_count}{c.max_redemptions != null ? ` / ${c.max_redemptions}` : ''}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{c.starts_at ? new Date(c.starts_at).toLocaleDateString() : '—'} → {c.ends_at ? new Date(c.ends_at).toLocaleDateString() : '—'}</td>
                  <td className="px-3 py-2"><CampaignStatusBadge status={c.status} />{!elig.eligible && c.status === 'active' && <div className="text-xs text-amber-600 dark:text-amber-400">{elig.reason}</div>}</td>
                  <td className="px-3 py-2"><CampaignStatusActions id={c.id} status={c.status} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border">
        <div className="border-b px-4 py-3 text-sm font-semibold">Commission plan templates</div>
        <div className="card-grid grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {(plans ?? []).map((pl) => (
            <div key={pl.key} className="rounded-lg border p-3">
              <div className="flex items-center justify-between"><span className="font-semibold">{pl.label}</span><span className="text-xs text-muted-foreground">{pl.is_active ? 'active' : 'inactive'}</span></div>
              <div className="mt-1 font-mono text-xs text-muted-foreground">{pl.key}</div>
              <div className="mt-2 text-xs">{describePlan(pl.plan)}</div>
            </div>
          ))}
          {(plans ?? []).length === 0 && <p className="text-sm text-muted-foreground">No plan templates.</p>}
        </div>
      </section>
    </div>
  )
}
