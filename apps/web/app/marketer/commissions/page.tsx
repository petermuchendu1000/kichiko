// app/marketer/commissions/page.tsx — the marketer's payout_items, grouped by run.
//
// RLS ("Payout items readable": user_id = auth.uid()) scopes rows to the caller.
// Amounts are stored in USD and rendered in KES at the LIVE rate (kes2 for
// line-item precision). Grouping/aggregation is done by the pure helpers so it
// is unit-tested and identical to what the DB would compute.
import { requireMarketer } from '@/lib/marketer/guard'
import { buildRatesMap } from '@/lib/currency'
import { kes, kes2 } from '@/lib/admin/money'
import { groupPayoutsByRun, summarizeCommissions, type PayoutItemRow } from '@/lib/marketer/console'
import { Kpi, KpiGrid, Panel, PanelHead, PanelBody, TableCard, Table, Th, Td, EmptyRow, EmptyState, Pill, toneFor } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'

const STATUS_TONE: Record<string, 'green' | 'amber' | 'blue' | 'slate' | 'red'> = {
  paid: 'green', disbursed: 'green', settled: 'green', sent: 'green',
  approved: 'blue', eligible: 'blue',
  pending: 'amber', held: 'amber',
  failed: 'red', rejected: 'red',
}

export default async function MarketerCommissionsPage() {
  const ctx = await requireMarketer()

  const [ratesRes, { data }] = await Promise.all([
    ctx.supabase.from('exchange_rates').select('from_currency, rate').eq('to_currency', 'USD'),
    ctx.supabase
      .from('payout_items')
      .select('run_id, amount_usd, status, settlement, eligible_at, created_at')
      .eq('user_id', ctx.user.id)
      .order('created_at', { ascending: false }),
  ])

  const rates = buildRatesMap((ratesRes.data as { from_currency: string; rate: number | string | null }[]) ?? [])
  const rows = (data ?? []) as PayoutItemRow[]
  const totals = summarizeCommissions(rows)
  const groups = groupPayoutsByRun(rows)

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid className="lg:grid-cols-3">
        <Kpi label="Pending commission" value={kes(totals.pendingUsd, rates)} sub="Awaiting payout" tone={totals.pendingUsd > 0 ? 'attention' : 'default'} />
        <Kpi label="Paid commission" value={kes(totals.paidUsd, rates)} sub="Disbursed to date" />
        <Kpi label="Total" value={kes(totals.totalUsd, rates)} sub={`${totals.count.toLocaleString()} line items`} />
      </KpiGrid>

      {groups.length === 0 ? (
        <Panel>
          <PanelBody>
            <EmptyState title="No commissions yet" description="Commission line items will appear here once your referrals start generating payouts." />
          </PanelBody>
        </Panel>
      ) : (
        groups.map((g) => (
          <Panel key={g.runId ?? 'unassigned'}>
            <PanelHead
              title={g.runId ? `Payout run ${g.runId.slice(0, 8)}` : 'Not yet assigned to a run'}
              description={g.latest ? `Latest activity ${new Date(g.latest).toLocaleDateString()}` : undefined}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  {g.statuses.map((s) => (
                    <Pill key={s} tone={toneFor(s, STATUS_TONE)}>{s}</Pill>
                  ))}
                  <span className="text-sm font-semibold text-[var(--text-primary)]">{kes(g.totalUsd, rates)}</span>
                </div>
              }
            />
            <div className="table-wrapper overflow-x-auto">
              <Table>
                <caption className="sr-only">Commission line items for this payout run</caption>
                <thead>
                  <tr>
                    <Th>Status</Th>
                    <Th>Settlement</Th>
                    <Th>Eligible</Th>
                    <Th>Created</Th>
                    <Th num>Amount (KES)</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.filter((r) => (r.run_id ?? '__unassigned__') === (g.runId ?? '__unassigned__')).length === 0 && (
                    <EmptyRow colSpan={5}>No line items.</EmptyRow>
                  )}
                  {rows
                    .filter((r) => (r.run_id ?? '__unassigned__') === (g.runId ?? '__unassigned__'))
                    .map((r, i) => (
                      <tr key={`${g.runId ?? 'u'}-${i}`}>
                        <Td><Pill tone={toneFor(r.status ?? '', STATUS_TONE)} dot>{r.status ?? '—'}</Pill></Td>
                        <Td>{r.settlement ?? '—'}</Td>
                        <Td>{r.eligible_at ? new Date(r.eligible_at).toLocaleDateString() : '—'}</Td>
                        <Td>{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</Td>
                        <Td num>{kes2(r.amount_usd, rates)}</Td>
                      </tr>
                    ))}
                </tbody>
              </Table>
            </div>
          </Panel>
        ))
      )}
    </div>
  )
}
