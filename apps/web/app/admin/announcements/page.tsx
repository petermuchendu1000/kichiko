// app/admin/announcements/page.tsx — compose, schedule & send broadcast/segmented
// announcements. Gated by announcements:send. The compose form previews the
// resolved audience; sending is an explicit, confirmed action per row.
import Link from 'next/link'
import { requirePageCapability } from '@/lib/admin/page-guard'
import {
  fetchAnnouncements,
  parseAnnouncementListParams,
  ANNOUNCEMENT_STATUSES,
  statusLabel,
  channelLabel,
  normalizeAudience,
  describeAudience,
  type AnnouncementListParams,
} from '@/lib/admin/announcements'
import { AnnouncementForm } from '@/components/admin/announcements/AnnouncementForm'
import { AnnouncementActions } from '@/components/admin/announcements/AnnouncementActions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Announcements' }

// ISO alpha-2 codes for the platform's East-Africa footprint (matches profiles.country_code).
const COUNTRIES = ['KE', 'UG', 'TZ', 'RW', 'ZM', 'ET', 'BI']

const STATUS_PILL: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  scheduled: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  sending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  sent: 'bg-green-500/10 text-green-600 dark:text-green-400',
  cancelled: 'bg-red-500/10 text-red-600 dark:text-red-400',
}

function qs(p: AnnouncementListParams, o: Partial<AnnouncementListParams>): string {
  const m = { ...p, ...o }
  const sp = new URLSearchParams()
  if (m.status) sp.set('status', m.status)
  if (m.q) sp.set('q', m.q)
  sp.set('page', String(m.page))
  return sp.toString()
}

function timeLabel(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
}

export default async function AnnouncementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requirePageCapability('announcements:send')
  const params = parseAnnouncementListParams(await searchParams)
  const { rows, total } = await fetchAnnouncements(ctx.supabase, params)
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Announcements</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString()} announcement{total === 1 ? '' : 's'} · broadcast or segment across in-app, SMS & email
          </p>
        </div>
        <AnnouncementForm countries={COUNTRIES} />
      </div>

      {/* Filters */}
      <form className="flex flex-wrap items-end gap-2" action="/admin/announcements" method="get">
        <div>
          <label htmlFor="status" className="text-xs text-muted-foreground">Status</label>
          <select id="status" name="status" defaultValue={params.status ?? ''} className="block rounded-lg border bg-background px-2 py-1.5 text-sm">
            <option value="">All</option>
            {ANNOUNCEMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="search-title" className="text-xs text-muted-foreground">Search title</label>
          <input id="search-title" name="q" defaultValue={params.q ?? ''} placeholder="title contains…" className="block rounded-lg border bg-background px-2 py-1.5 text-sm" />
        </div>
        <button className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground">Apply</button>
        <Link href="/admin/announcements" className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">Reset</Link>
      </form>

      {/* Table */}
      <div className="table-wrapper overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Channels</th>
              <th className="px-3 py-2">Audience</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Recipients</th>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No announcements yet.</td>
              </tr>
            )}
            {rows.map((a) => {
              const aud = normalizeAudience((a.audience as unknown) ?? {})
              const when = a.status === 'sent' ? a.sent_at : a.scheduled_at ?? a.created_at
              return (
                <tr key={a.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{a.title}</div>
                    <p className="max-w-xs truncate text-xs text-muted-foreground" title={a.body}>{a.body}</p>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {(a.channels ?? []).map((c) => (
                        <span key={c} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{channelLabel(c)}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 max-w-[200px] text-xs text-muted-foreground">{describeAudience(aud)}</td>
                  <td className="px-3 py-2">
                    <span className={'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ' + (STATUS_PILL[a.status] ?? 'bg-muted text-muted-foreground')}>
                      {statusLabel(a.status)}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{a.recipient_count?.toLocaleString() ?? 0}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{timeLabel(when)}</td>
                  <td className="px-3 py-2">
                    <AnnouncementActions id={a.id} status={a.status} />
                  </td>
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
              <Link href={`/admin/announcements?${qs(params, { page: params.page - 1 })}`} className="rounded-lg border px-3 py-1.5 hover:bg-muted">Previous</Link>
            )}
            {params.page < totalPages && (
              <Link href={`/admin/announcements?${qs(params, { page: params.page + 1 })}`} className="rounded-lg border px-3 py-1.5 hover:bg-muted">Next</Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
