// app/admin/audit/page.tsx — searchable audit log & security-event viewer.
// Read-only, gated by audit:read (RLS enforces it too). Supports actor / entity
// / action / date filters, a security-only view, and CSV export.
import Link from 'next/link'
import { requirePageCapability } from '@/lib/admin/page-guard'
import {
  fetchAuditLog,
  parseAuditParams,
  isSecurityAction,
  type AuditListParams,
} from '@/lib/admin/audit'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Audit & Security' }

function qs(p: AuditListParams, o: Partial<AuditListParams> & { view?: string }): string {
  const m = { ...p, ...o }
  const sp = new URLSearchParams()
  if (m.actor) sp.set('actor', m.actor)
  if (m.entityType) sp.set('entityType', m.entityType)
  if (m.entityId) sp.set('entityId', m.entityId)
  if (m.action) sp.set('action', m.action)
  if (m.from) sp.set('from', m.from)
  if (m.to) sp.set('to', m.to)
  if ((o as { view?: string }).view) sp.set('view', (o as { view?: string }).view as string)
  sp.set('page', String(m.page))
  return sp.toString()
}

function timeLabel(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    year: '2-digit', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = await searchParams
  const ctx = await requirePageCapability('audit:read')
  const params = parseAuditParams(raw)
  const securityOnly = (Array.isArray(raw.view) ? raw.view[0] : raw.view) === 'security'

  const { rows, total } = await fetchAuditLog(ctx.supabase, params)
  const visible = securityOnly ? rows.filter((r) => isSecurityAction(r.action)) : rows
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Audit &amp; Security</h1>
          <p className="text-sm text-muted-foreground">{total.toLocaleString()} log entries · actor, entity &amp; before/after snapshots</p>
        </div>
        <a
          href={`/api/admin/audit/export?${qs(params, { page: 1 })}`}
          className="rounded-lg border bg-background px-3 py-2 text-sm font-semibold hover:bg-muted"
        >
          Export CSV
        </a>
      </div>

      {/* View toggle */}
      <div className="flex gap-2 text-sm">
        <Link
          href={`/admin/audit?${qs(params, { page: 1 })}`}
          className={'rounded-lg px-3 py-1.5 ' + (securityOnly ? 'border hover:bg-muted' : 'bg-primary text-primary-foreground')}
        >
          All events
        </Link>
        <Link
          href={`/admin/audit?${qs(params, { page: 1, view: 'security' })}`}
          className={'rounded-lg px-3 py-1.5 ' + (securityOnly ? 'bg-primary text-primary-foreground' : 'border hover:bg-muted')}
        >
          Security only
        </Link>
      </div>

      {/* Filters */}
      <form className="flex flex-wrap items-end gap-2" action="/admin/audit" method="get">
        {securityOnly && <input type="hidden" name="view" value="security" />}
        <div>
          <label htmlFor="action" className="text-xs text-muted-foreground">Action</label>
          <input id="action" name="action" defaultValue={params.action ?? ''} placeholder="e.g. user.set_role" className="block rounded-lg border bg-background px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label htmlFor="entity-type" className="text-xs text-muted-foreground">Entity type</label>
          <input id="entity-type" name="entityType" defaultValue={params.entityType ?? ''} placeholder="e.g. profile" className="block rounded-lg border bg-background px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label htmlFor="actor-uuid" className="text-xs text-muted-foreground">Actor (UUID)</label>
          <input id="actor-uuid" name="actor" defaultValue={params.actor ?? ''} placeholder="profile id" className="block w-44 rounded-lg border bg-background px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label htmlFor="from" className="text-xs text-muted-foreground">From</label>
          <input id="from" type="date" name="from" defaultValue={params.from ?? ''} className="block rounded-lg border bg-background px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label htmlFor="to" className="text-xs text-muted-foreground">To</label>
          <input id="to" type="date" name="to" defaultValue={params.to ?? ''} className="block rounded-lg border bg-background px-2 py-1.5 text-sm" />
        </div>
        <button className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">Apply</button>
        <Link href="/admin/audit" className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">Reset</Link>
      </form>

      {/* Table */}
      <div className="table-wrapper overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No audit entries match these filters.</td>
              </tr>
            )}
            {visible.map((r) => (
              <tr key={r.id} className={isSecurityAction(r.action) ? 'bg-amber-500/5' : undefined}>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{timeLabel(r.created_at)}</td>
                <td className="px-3 py-2">{r.actor?.display_name || r.actor?.username || <span className="text-muted-foreground">system</span>}</td>
                <td className="px-3 py-2"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.action}</code></td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {r.entity_type ? (
                    <span>
                      {r.entity_type}
                      {r.entity_id && <span className="ml-1 font-mono">{r.entity_id.slice(0, 8)}…</span>}
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.ip_address ? String(r.ip_address) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && !securityOnly && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Page {params.page} of {totalPages}</span>
          <div className="flex gap-2">
            {params.page > 1 && (
              <Link href={`/admin/audit?${qs(params, { page: params.page - 1 })}`} className="rounded-lg border px-3 py-1.5 hover:bg-muted">Previous</Link>
            )}
            {params.page < totalPages && (
              <Link href={`/admin/audit?${qs(params, { page: params.page + 1 })}`} className="rounded-lg border px-3 py-1.5 hover:bg-muted">Next</Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
