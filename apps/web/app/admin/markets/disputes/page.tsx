// app/admin/markets/disputes/page.tsx — Disputed market queue.
import Link from 'next/link'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { MarketStatusBadge } from '@/components/admin/markets/MarketBadges'
import { PageHeader, Panel, Pill, EmptyState } from '@/components/admin/ui'
import { IconGavel, IconClock, IconArrowRight } from '@/components/ui/icons'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Event disputes' }

export default async function DisputesPage() {
  const ctx = await requirePageCapability(['markets:resolve', 'markets:cancel'])

  const { data, error } = await ctx.supabase
    .from('markets')
    .select('id, title, slug, status, closes_at, resolves_at, total_volume_usd, resolution_notes, updated_at, creator:profiles!markets_creator_id_fkey(username)')
    .eq('status', 'disputed')
    .order('updated_at', { ascending: true })
    .limit(200)

  if (error) throw new Error(error.message)
  const rows = data ?? []

  return (
    <div>
      <PageHeader
        crumbs={[{ label: 'Events', href: '/admin/markets' }, { label: 'Disputes' }]}
        title="Dispute queue"
        description="Events flagged for dispute, oldest first. Resolve or cancel each before its SLA lapses."
        meta={<Pill tone={rows.length > 0 ? 'red' : 'green'} dot>{rows.length} open</Pill>}
      />

      {rows.length === 0 ? (
        <Panel>
          <EmptyState icon={<IconGavel size={20} />} title="No disputed events" description="Every disputed event has been resolved. The queue is clear." />
        </Panel>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((m) => {
            const creator = (m as { creator?: { username: string | null } | null }).creator
            const ageHrs = m.updated_at ? Math.round((Date.now() - new Date(m.updated_at).getTime()) / 3_600_000) : null
            const overdue = ageHrs != null && ageHrs >= 48
            return (
              <Panel key={m.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/admin/markets/${m.id}`} className="font-semibold text-[var(--text-primary)] hover:text-[var(--green)]">{m.title}</Link>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                      <span>by {creator?.username ?? '—'}</span>
                      <span className="inline-flex items-center gap-1">
                        <IconClock size={12} /> SLA age: {ageHrs != null ? `${ageHrs}h` : '—'}
                      </span>
                      {overdue && <Pill tone="red">Overdue</Pill>}
                    </p>
                  </div>
                  <MarketStatusBadge status={m.status} />
                </div>
                {m.resolution_notes && (
                  <p className="mt-3 whitespace-pre-wrap rounded-lg bg-[var(--bg-secondary)] p-3 text-xs text-[var(--text-secondary)]">{m.resolution_notes}</p>
                )}
                <div className="mt-3">
                  <Link href={`/admin/markets/${m.id}`} className="btn btn-secondary btn-sm gap-1.5">
                    Review &amp; resolve <IconArrowRight size={14} />
                  </Link>
                </div>
              </Panel>
            )
          })}
        </div>
      )}
    </div>
  )
}
