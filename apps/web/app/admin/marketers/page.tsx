// app/admin/marketers/page.tsx — Marketer directory, applications & quick links.
import Link from 'next/link'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { createAdminClient } from '@/lib/supabase/server'
import { parseMarketerListParams, describePlan, type MarketerListParams } from '@/lib/admin/marketers'
import { ProfileStatusBadge } from '@/components/admin/growth/Badges'
import { ApplicationActions } from '@/components/admin/growth/ApplicationActions'
import { MarketerStatusActions } from '@/components/admin/growth/MarketerActions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Marketer Management' }

interface JoinedProfile {
  username: string | null
  display_name: string | null
  country_code: string | null
  referral_count: number | null
}

function qs(p: MarketerListParams, o: Partial<MarketerListParams>): string {
  const m = { ...p, ...o }
  const sp = new URLSearchParams()
  if (m.status) sp.set('status', m.status)
  if (m.q) sp.set('q', m.q)
  sp.set('page', String(m.page))
  return sp.toString()
}

export default async function MarketersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requirePageCapability('marketers:manage')
  const params = parseMarketerListParams(await searchParams)
  const sb = await createAdminClient()

  const from = (params.page - 1) * params.pageSize
  let dirQ = sb
    .from('marketer_profiles')
    .select(
      'user_id, tracking_code, commission_plan, hold_days, status, created_at, profiles!marketer_profiles_user_id_fkey(username, display_name, country_code, referral_count)',
      { count: 'exact' }
    )
  if (params.status) dirQ = dirQ.eq('status', params.status)
  if (params.q) dirQ = dirQ.ilike('tracking_code', `%${params.q.toUpperCase()}%`)
  dirQ = dirQ.order('created_at', { ascending: params.dir === 'asc' }).range(from, from + params.pageSize - 1)

  const [{ data: marketers, count }, { data: apps }, { count: campaignCount }] = await Promise.all([
    dirQ,
    sb
      .from('role_applications')
      .select('id, user_id, status, message, created_at, profiles!role_applications_user_id_fkey(username, display_name)')
      .eq('kind', 'marketer')
      .eq('status', 'pending')
      .order('created_at', { ascending: true }),
    sb.from('campaigns').select('id', { count: 'exact', head: true }).eq('status', 'active'),
  ])

  const total = count ?? 0
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize))

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black">Marketer Management</h1>
        <div className="flex items-center gap-2">
          <Link href="/admin/marketers/campaigns" className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">Campaigns ({campaignCount ?? 0})</Link>
          <Link href="/admin/marketers/payouts" className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">Payout runs</Link>
          <a href="/api/admin/marketers/export" className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">Export CSV</a>
        </div>
      </div>

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
                      <td className="px-3 py-2"><ApplicationActions applicationId={a.id} userId={a.user_id} kind="marketer" tiers={[]} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <form method="get" className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <input type="search" name="q" defaultValue={params.q ?? ''} placeholder="Tracking code…" className="rounded-lg border bg-background px-3 py-2 text-sm" />
          <select name="status" defaultValue={params.status ?? ''} className="rounded-lg border bg-background px-3 py-2 text-sm">
            {['', 'active', 'suspended', 'revoked'].map((s) => <option key={s} value={s}>{s === '' ? 'Any status' : s}</option>)}
          </select>
          <button type="submit" className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">Filter</button>
        </form>

        <div className="table-wrapper overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-3 py-2">Marketer</th><th className="px-3 py-2">Code</th><th className="px-3 py-2">Plan</th><th className="px-3 py-2 text-right">Referrals</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right">Actions</th></tr>
            </thead>
            <tbody>
              {(marketers ?? []).length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No marketers match.</td></tr>}
              {(marketers ?? []).map((m) => {
                const p = m.profiles as unknown as JoinedProfile | null
                return (
                  <tr key={m.user_id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2"><Link href={`/admin/marketers/${m.user_id}`} className="text-primary hover:underline">{p?.username ?? m.user_id.slice(0, 8)}</Link><div className="text-xs text-muted-foreground">{p?.display_name}{p?.country_code ? ` · ${p.country_code}` : ''}</div></td>
                    <td className="px-3 py-2 font-mono text-xs">{m.tracking_code}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{describePlan(m.commission_plan)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{p?.referral_count ?? 0}</td>
                    <td className="px-3 py-2"><ProfileStatusBadge status={m.status} /></td>
                    <td className="px-3 py-2"><MarketerStatusActions userId={m.user_id} status={m.status} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{total.toLocaleString()} marketers</span>
          <div className="flex gap-2">
            {params.page > 1 && <Link href={`/admin/marketers?${qs(params, { page: params.page - 1 })}`} className="rounded-lg border px-3 py-1.5 hover:bg-muted">← Prev</Link>}
            <span className="px-2 py-1.5 text-muted-foreground">Page {params.page} / {totalPages}</span>
            {params.page < totalPages && <Link href={`/admin/marketers?${qs(params, { page: params.page + 1 })}`} className="rounded-lg border px-3 py-1.5 hover:bg-muted">Next →</Link>}
          </div>
        </div>
      </section>
    </div>
  )
}
