// app/marketer/referrals/page.tsx — the marketer's own referrals.
//
// RLS ("Users can view own referrals": referrer_id = auth.uid()) already scopes
// the query; we additionally filter by referrer_id so oversight roles see the
// referrals THEY own rather than everyone's. Purely a listing — no money.
import { requireMarketer } from '@/lib/marketer/guard'
import { isActiveReferral, summarizeReferrals, type ReferralRow } from '@/lib/marketer/console'
import { Kpi, KpiGrid, TableCard, Table, Th, Td, EmptyRow, Pill } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'

export default async function MarketerReferralsPage() {
  const ctx = await requireMarketer()
  const { data } = await ctx.supabase
    .from('referrals')
    .select('id, status, referral_code, qualified_at, created_at')
    .eq('referrer_id', ctx.user.id)
    .order('created_at', { ascending: false })

  const rows = (data ?? []) as (ReferralRow & { id: string; referral_code: string | null })[]
  const summary = summarizeReferrals(rows)

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid className="lg:grid-cols-3">
        <Kpi label="Total referrals" value={summary.total.toLocaleString()} />
        <Kpi label="Active" value={summary.active.toLocaleString()} sub="Qualified / converted" />
        <Kpi label="Pending" value={summary.pending.toLocaleString()} sub="Not yet qualified" />
      </KpiGrid>

      <TableCard>
        <Table>
          <caption className="sr-only">Your referrals with status and join date</caption>
          <thead>
            <tr>
              <Th>Referral code</Th>
              <Th>Status</Th>
              <Th>Joined</Th>
              <Th>Qualified</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={4}>You have no referrals yet.</EmptyRow>}
            {rows.map((r) => {
              const active = isActiveReferral(r)
              return (
                <tr key={r.id}>
                  <Td><span className="font-mono">{r.referral_code ?? '—'}</span></Td>
                  <Td>
                    <Pill tone={active ? 'green' : 'slate'} dot>
                      {r.status ?? (active ? 'active' : 'pending')}
                    </Pill>
                  </Td>
                  <Td>{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</Td>
                  <Td>{r.qualified_at ? new Date(r.qualified_at).toLocaleDateString() : '—'}</Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </TableCard>
    </div>
  )
}
