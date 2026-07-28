// app/marketer/campaigns/page.tsx — active campaigns to promote + own redemptions.
//
// RLS gives marketers read on active campaigns ("status = 'active'") and on
// their OWN campaign_redemptions ("user_id = auth.uid()"). Budget/value amounts
// are stored in USD and rendered in KES at the LIVE rate. Percentages are shown
// as-is (they are not currency).
import { requireMarketer } from '@/lib/marketer/guard'
import { buildRatesMap } from '@/lib/currency'
import { kes, kes2 } from '@/lib/admin/money'
import { summarizeRedemptions, redemptionsByCampaign, type RedemptionRow } from '@/lib/marketer/console'
import { Kpi, KpiGrid, TableCard, Table, Th, Td, EmptyRow, Pill } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'

interface CampaignRow {
  id: string
  code: string | null
  label: string | null
  kind: string | null
  value_pct: number | string | null
  max_value_usd: number | string | null
  budget_usd: number | string | null
  spent_usd: number | string | null
  starts_at: string | null
  ends_at: string | null
  status: string | null
}

function pct(v: number | string | null): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? `${n}%` : '—'
}

export default async function MarketerCampaignsPage() {
  const ctx = await requireMarketer()

  const [ratesRes, campaignsRes, redemptionsRes] = await Promise.all([
    ctx.supabase.from('exchange_rates').select('from_currency, rate').eq('to_currency', 'USD'),
    ctx.supabase
      .from('campaigns')
      .select('id, code, label, kind, value_pct, max_value_usd, budget_usd, spent_usd, starts_at, ends_at, status')
      .eq('status', 'active')
      .order('created_at', { ascending: false }),
    ctx.supabase
      .from('campaign_redemptions')
      .select('campaign_id, amount_usd, created_at')
      .eq('user_id', ctx.user.id)
      .order('created_at', { ascending: false }),
  ])

  const rates = buildRatesMap((ratesRes.data as { from_currency: string; rate: number | string | null }[]) ?? [])
  const campaigns = (campaignsRes.data ?? []) as CampaignRow[]
  const redemptions = (redemptionsRes.data ?? []) as RedemptionRow[]
  const redSummary = summarizeRedemptions(redemptions)
  const byCampaign = redemptionsByCampaign(redemptions)

  return (
    <div className="flex flex-col gap-6">
      <KpiGrid className="lg:grid-cols-3">
        <Kpi label="Active campaigns" value={campaigns.length.toLocaleString()} sub="Available to promote" />
        <Kpi label="Your redemptions" value={redSummary.count.toLocaleString()} />
        <Kpi label="Redemption value" value={kes(redSummary.totalUsd, rates)} sub="Across your redemptions" />
      </KpiGrid>

      <section aria-labelledby="active-heading" className="flex flex-col gap-3">
        <h2 id="active-heading" className="text-sm font-semibold text-[var(--text-primary)]">Active campaigns</h2>
        <TableCard>
          <Table>
            <caption className="sr-only">Active campaigns you can promote</caption>
            <thead>
              <tr>
                <Th>Campaign</Th>
                <Th>Code</Th>
                <Th>Type</Th>
                <Th num>Value</Th>
                <Th num>Max / redemption</Th>
                <Th>Ends</Th>
                <Th num>Your redemptions</Th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 && <EmptyRow colSpan={7}>No active campaigns right now.</EmptyRow>}
              {campaigns.map((c) => {
                const mine = byCampaign[c.id]
                return (
                  <tr key={c.id}>
                    <Td>{c.label ?? '—'}</Td>
                    <Td><span className="font-mono">{c.code ?? '—'}</span></Td>
                    <Td><Pill tone="blue">{c.kind ?? '—'}</Pill></Td>
                    <Td num>{c.kind === 'percentage' || c.value_pct != null ? pct(c.value_pct) : '—'}</Td>
                    <Td num>{c.max_value_usd != null ? kes(c.max_value_usd, rates) : '—'}</Td>
                    <Td>{c.ends_at ? new Date(c.ends_at).toLocaleDateString() : '—'}</Td>
                    <Td num>{mine ? `${mine.count} · ${kes(mine.totalUsd, rates)}` : '—'}</Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </TableCard>
      </section>

      <section aria-labelledby="redemptions-heading" className="flex flex-col gap-3">
        <h2 id="redemptions-heading" className="text-sm font-semibold text-[var(--text-primary)]">Your redemptions</h2>
        <TableCard>
          <Table>
            <caption className="sr-only">Your campaign redemptions</caption>
            <thead>
              <tr>
                <Th>Campaign</Th>
                <Th>Date</Th>
                <Th num>Amount (KES)</Th>
              </tr>
            </thead>
            <tbody>
              {redemptions.length === 0 && <EmptyRow colSpan={3}>You have no redemptions yet.</EmptyRow>}
              {redemptions.map((r, i) => {
                const c = campaigns.find((x) => x.id === r.campaign_id)
                return (
                  <tr key={`${r.campaign_id ?? 'r'}-${i}`}>
                    <Td>{c?.label ?? (r.campaign_id ? r.campaign_id.slice(0, 8) : '—')}</Td>
                    <Td>{r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}</Td>
                    <Td num>{kes2(r.amount_usd, rates)}</Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        </TableCard>
      </section>
    </div>
  )
}
