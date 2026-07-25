// app/admin/kyc/page.tsx — KYC / compliance review queue.
import Link from 'next/link'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { KycReviewActions } from '@/components/admin/kyc/KycReviewActions'
import { KycBadge } from '@/components/admin/users/Badges'
import { PageHeader, Panel, Segmented, EmptyState } from '@/components/admin/ui'
import { IconShield, IconClock } from '@/components/ui/icons'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · KYC' }

export default async function KycQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requirePageCapability('kyc:review')
  const sp = await searchParams
  const rawStatus = (Array.isArray(sp.status) ? sp.status[0] : sp.status) || 'pending'
  const statuses = ['pending', 'verified', 'rejected', 'unverified'] as const
  type KycStatus = (typeof statuses)[number]
  const status: KycStatus = (statuses as readonly string[]).includes(rawStatus)
    ? (rawStatus as KycStatus)
    : 'pending'

  const { data: docs } = await ctx.supabase
    .from('kyc_documents')
    .select('id, user_id, document_type, document_number, country_of_issue, status, rejection_reason, created_at')
    .eq('status', status)
    .order('created_at', { ascending: true })
    .limit(100)

  const userIds = Array.from(new Set((docs ?? []).map((d) => d.user_id)))
  const { data: profiles } = userIds.length
    ? await ctx.supabase.from('profiles').select('id, display_name, username, country_code').in('id', userIds)
    : { data: [] as { id: string; display_name: string | null; username: string | null; country_code: string | null }[] }
  const pmap = new Map((profiles ?? []).map((p) => [p.id, p]))
  const rows = docs ?? []

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="KYC & Compliance"
        description="Verify identity documents before users unlock deposits, withdrawals and higher limits."
        meta={<span>{rows.length}{rows.length === 100 ? '+' : ''} {status} document{rows.length === 1 ? '' : 's'}</span>}
        actions={
          <Segmented
            active={status}
            options={statuses.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1), href: `/admin/kyc?status=${s}` }))}
          />
        }
      />

      <div className="space-y-3">
        {rows.map((d) => {
          const p = pmap.get(d.user_id)
          return (
            <Panel key={d.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/admin/users/${d.user_id}`} className="font-semibold text-[var(--text-primary)] hover:text-[var(--green)]">
                      {p?.display_name || p?.username || d.user_id.slice(0, 8)}
                    </Link>
                    <KycBadge status={d.status} />
                  </div>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    <span className="font-medium capitalize">{d.document_type?.replace(/_/g, ' ')}</span>
                    {d.document_number ? ` · ${d.document_number}` : ''} · {d.country_of_issue || p?.country_code || '—'}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                    <IconClock size={12} /> Submitted {d.created_at ? new Date(d.created_at).toLocaleString() : '—'}
                  </p>
                  {d.rejection_reason && (
                    <p className="mt-2 rounded-md bg-red-500/10 px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400">
                      Reason: {d.rejection_reason}
                    </p>
                  )}
                </div>
                {status === 'pending' && <KycReviewActions docId={d.id} />}
              </div>
            </Panel>
          )
        })}
        {rows.length === 0 && (
          <Panel>
            <EmptyState
              icon={<IconShield size={20} />}
              title={`No ${status} documents`}
              description={status === 'pending' ? 'The review queue is clear. Nicely done.' : `There are no ${status} KYC documents right now.`}
            />
          </Panel>
        )}
      </div>
    </div>
  )
}
