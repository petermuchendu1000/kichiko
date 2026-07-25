// app/admin/creators/page.tsx — Creator directory, applications & tiers.
import Link from 'next/link'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { parseCreatorListParams, formatRewardPct, type CreatorListParams } from '@/lib/admin/creators'
import { ProfileStatusBadge, TierBadge, ApplicationStatusBadge } from '@/components/admin/growth/Badges'
import { ApplicationActions } from '@/components/admin/growth/ApplicationActions'
import { CreatorStatusActions } from '@/components/admin/growth/CreatorActions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Creator Management' }

interface JoinedProfile {
  username: string | null
  display_name: string | null
  country_code: string | null
}

function qs(p: CreatorListParams, o: Partial<CreatorListParams>): string {
  const m = { ...p, ...o }
  const sp = new URLSearchParams()
  if (m.status) sp.set('status', m.status)
  if (m.tier) sp.set('tier', m.tier)
  if (m.q) sp.set('q', m.q)
  sp.set('page', String(m.page))
  return sp.toString()
}

export default async function CreatorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requirePageCapability('creators:manage')
  const params = parseCreatorListParams(await searchParams)
  const sb = ctx.supabase

  const from = (params.page - 1) * params.pageSize
  let dirQ = sb
    .from('creator_profiles')
    .select(
      'user_id, tier, reward_pct, auto_publish, max_open_markets, status, created_at, profiles!creator_profiles_user_id_fkey(username, display_name, country_code)',
      { count: 'exact' }
    )
  if (params.status) dirQ = dirQ.eq('status', params.status)
  if (params.tier) dirQ = dirQ.eq('tier', params.tier)
  dirQ = dirQ.order('created_at', { ascending: params.dir === 'asc' }).range(from, from + params.pageSize - 1)

  const [{ data: creators, count }, { data: apps }, { data: tiers }] = await Promise.all([
    dirQ,
    sb
      .from('role_applications')
      .select('id, user_id, status, message, created_at, profiles!role_applications_user_id_fkey(username, display_name)')
      .eq('kind', 'creator')
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
    sb.from('creator_tiers').select('key, label, reward_pct, max_open_markets, auto_publish, is_active').order('sort_order'),
  ])

  const tierKeys = (tiers ?? []).filter((t) => t.is_active).map((t) => t.key)
  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize))

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-black">Creator Management</h1>
        <a href="/api/admin/creators/export" className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">Export CSV</a>
      </div>

      {/* Applications */}
      {(apps ?? []).length > 0 && (
        <section className="rounded-xl border">
          <div className="border-b px-4 py-3 text-sm font-semibold">Pending applications ({apps!.length})</div>
          <div className="table-wrapper overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr><th className="px-3 py-2">User</th><th className="px-3 py-2">Message</th><th className="px-3 py-2">Applied</th><th className="px-3 py-2 text-right">Action</th></tr>
              </thead>
              <tbody>
                {(apps ?? []).map((a) => {
                  const p = a.profiles as unknown as JoinedProfile | null
                  return (
                    <tr key={a.id} className="border-t">
                      <td className="px-3 py-2"><Link href={`/admin/users/${a.user_id}`} className="text-primary hover:underline">{p?.username ?? a.user_id.slice(0, 8)}</Link></td>
                      <td className="px-3 py-2 text-muted-foreground">{a.message ?? '—'}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(a.created_at).toLocaleDateString()}</td>
                      <td className="px-3 py-2"><ApplicationActions applicationId={a.id} userId={a.user_id} kind="creator" tiers={tierKeys} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Tiers */}
      <section className="rounded-xl border">
        <div className="border-b px-4 py-3 text-sm font-semibold">Creator tiers</div>
        <div className="card-grid grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {(tiers ?? []).map((t) => (
            <div key={t.key} className="rounded-lg border p-3">
              <div className="flex items-center justify-between"><TierBadge tier={t.key} /><span className="text-xs text-muted-foreground">{t.is_active ? 'active' : 'inactive'}</span></div>
              <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
                <div className="flex justify-between"><dt>Reward</dt><dd className="tabular-nums text-foreground">{formatRewardPct(Number(t.reward_pct))}</dd></div>
                <div className="flex justify-between"><dt>Max open markets</dt><dd className="tabular-nums text-foreground">{t.max_open_markets}</dd></div>
                <div className="flex justify-between"><dt>Auto-publish</dt><dd className="text-foreground">{t.auto_publish ? 'yes' : 'no'}</dd></div>
              </dl>
            </div>
          ))}
        </div>
      </section>

      {/* Directory */}
      <section>
        <form method="get" className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <select name="status" defaultValue={params.status ?? ''} className="rounded-lg border bg-background px-3 py-2 text-sm">
            {['', 'active', 'suspended', 'revoked'].map((s) => <option key={s} value={s}>{s === '' ? 'Any status' : s}</option>)}
          </select>
          <select name="tier" defaultValue={params.tier ?? ''} className="rounded-lg border bg-background px-3 py-2 text-sm">
            <option value="">Any tier</option>
            {tierKeys.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button type="submit" className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Filter</button>
        </form>

        <div className="table-wrapper overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-3 py-2">Creator</th><th className="px-3 py-2">Tier</th><th className="px-3 py-2">Reward</th><th className="px-3 py-2">Auto</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {(creators ?? []).length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No creators match.</td></tr>}
              {(creators ?? []).map((c) => {
                const p = c.profiles as unknown as JoinedProfile | null
                return (
                  <tr key={c.user_id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2"><Link href={`/admin/creators/${c.user_id}`} className="text-primary hover:underline">{p?.username ?? c.user_id.slice(0, 8)}</Link><div className="text-xs text-muted-foreground">{p?.display_name}{p?.country_code ? ` · ${p.country_code}` : ''}</div></td>
                    <td className="px-3 py-2"><TierBadge tier={c.tier} /></td>
                    <td className="px-3 py-2 tabular-nums text-xs">{c.reward_pct != null ? formatRewardPct(Number(c.reward_pct)) : <span className="text-muted-foreground">tier</span>}</td>
                    <td className="px-3 py-2 text-xs">{c.auto_publish ? 'yes' : 'no'}</td>
                    <td className="px-3 py-2"><ProfileStatusBadge status={c.status} /></td>
                    <td className="px-3 py-2"><CreatorStatusActions userId={c.user_id} status={c.status} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{total.toLocaleString()} creators</span>
          <div className="flex gap-2">
            {params.page > 1 && <Link href={`/admin/creators?${qs(params, { page: params.page - 1 })}`} className="rounded-lg border px-3 py-1.5 hover:bg-muted">← Prev</Link>}
            <span className="px-2 py-1.5 text-muted-foreground">Page {params.page} / {totalPages}</span>
            {params.page < totalPages && <Link href={`/admin/creators?${qs(params, { page: params.page + 1 })}`} className="rounded-lg border px-3 py-1.5 hover:bg-muted">Next →</Link>}
          </div>
        </div>
      </section>
    </div>
  )
}
