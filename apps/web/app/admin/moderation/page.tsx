// app/admin/moderation/page.tsx — Content moderation: report inbox with SLA
// tracking and take-down/restore + resolve actions. Gated by moderation:read;
// action controls only render for operators holding moderation:action.
import Link from 'next/link'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { roleHasCapability } from '@/lib/admin/rbac'
import {
  fetchReports,
  fetchHiddenMarketCount,
  parseReportListParams,
  REPORT_STATUSES,
  REPORT_ENTITY_TYPES,
  REPORT_REASONS,
  slaDueAt,
  isOverdue,
  entityHref,
  type ReportListParams,
} from '@/lib/admin/moderation'
import { ReportStatusBadge, ReasonBadge, EntityBadge, SlaBadge } from '@/components/admin/moderation/Badges'
import { ReportActions } from '@/components/admin/moderation/ModerationActions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Content Moderation' }

function qs(p: ReportListParams, o: Partial<ReportListParams>): string {
  const m = { ...p, ...o }
  const sp = new URLSearchParams()
  if (m.status) sp.set('status', m.status)
  if (m.entity_type) sp.set('entity_type', m.entity_type)
  if (m.reason) sp.set('reason', m.reason)
  if (m.q) sp.set('q', m.q)
  sp.set('page', String(m.page))
  return sp.toString()
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default async function ModerationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requirePageCapability('moderation:read')
  const params = parseReportListParams(await searchParams)
  const canAct = roleHasCapability(ctx.role, 'moderation:action')

  const [{ rows, total }, hiddenCount] = await Promise.all([
    fetchReports(ctx.supabase, params),
    fetchHiddenMarketCount(ctx.supabase),
  ])
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Content Moderation</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString()} report{total === 1 ? '' : 's'} · {hiddenCount} market{hiddenCount === 1 ? '' : 's'} hidden
          </p>
        </div>
        <a
          href={`/api/admin/moderation/export?${qs(params, { page: 1 })}`}
          className="rounded-lg border bg-background px-3 py-2 text-sm font-semibold hover:bg-muted"
        >
          Export CSV
        </a>
      </div>

      {/* Filters */}
      <form className="flex flex-wrap items-end gap-2" action="/admin/moderation" method="get">
        <div>
          <label htmlFor="status" className="text-xs text-muted-foreground">Status</label>
          <select id="status" name="status" defaultValue={params.status ?? ''} className="block rounded-lg border bg-background px-2 py-1.5 text-sm">
            <option value="">All</option>
            {REPORT_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="type" className="text-xs text-muted-foreground">Type</label>
          <select id="type" name="entity_type" defaultValue={params.entity_type ?? ''} className="block rounded-lg border bg-background px-2 py-1.5 text-sm">
            <option value="">All</option>
            {REPORT_ENTITY_TYPES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="reason" className="text-xs text-muted-foreground">Reason</label>
          <select id="reason" name="reason" defaultValue={params.reason ?? ''} className="block rounded-lg border bg-background px-2 py-1.5 text-sm">
            <option value="">All</option>
            {REPORT_REASONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="search" className="text-xs text-muted-foreground">Search</label>
          <input id="search" name="q" defaultValue={params.q ?? ''} placeholder="entity id or details" className="block rounded-lg border bg-background px-2 py-1.5 text-sm" />
        </div>
        <button className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">Apply</button>
        <Link href="/admin/moderation" className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">Reset</Link>
      </form>

      {/* Table */}
      <div className="table-wrapper overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Reason</th>
              <th className="px-3 py-2">Reporter</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">SLA</th>
              <th className="px-3 py-2">Reported</th>
              {canAct && <th className="px-3 py-2 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && (
              <tr>
                <td colSpan={canAct ? 7 : 6} className="px-3 py-8 text-center text-muted-foreground">
                  No reports match these filters.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const href = entityHref(r.entity_type, r.entity_id)
              const overdue = isOverdue(r)
              return (
                <tr key={r.id} className={overdue ? 'bg-red-500/5' : undefined}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <EntityBadge entityType={r.entity_type} />
                      <Link href={href} className="max-w-[140px] truncate font-mono text-xs text-primary hover:underline" title={r.entity_id}>
                        {r.entity_id.slice(0, 8)}…
                      </Link>
                    </div>
                    {r.details && <p className="mt-1 max-w-xs truncate text-xs text-muted-foreground" title={r.details}>{r.details}</p>}
                  </td>
                  <td className="px-3 py-2"><ReasonBadge reason={r.reason} /></td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.reporter?.display_name || r.reporter?.username || '—'}
                  </td>
                  <td className="px-3 py-2"><ReportStatusBadge status={r.status} /></td>
                  <td className="px-3 py-2"><SlaBadge overdue={overdue} dueLabel={timeLabel(slaDueAt(r.created_at, r.reason).toISOString())} /></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{timeLabel(r.created_at)}</td>
                  {canAct && (
                    <td className="px-3 py-2">
                      <ReportActions reportId={r.id} entityType={r.entity_type} entityId={r.entity_id} status={r.status} />
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {params.page} of {totalPages}</span>
          <div className="flex gap-2">
            {params.page > 1 && (
              <Link href={`/admin/moderation?${qs(params, { page: params.page - 1 })}`} className="rounded-lg border px-3 py-1.5 hover:bg-muted">Previous</Link>
            )}
            {params.page < totalPages && (
              <Link href={`/admin/moderation?${qs(params, { page: params.page + 1 })}`} className="rounded-lg border px-3 py-1.5 hover:bg-muted">Next</Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
