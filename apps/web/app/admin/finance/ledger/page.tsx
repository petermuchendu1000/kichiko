// app/admin/finance/ledger/page.tsx — Unified transaction ledger: reconciliation
// summary, date-range filtering and CSV export on the shared admin UI kit.
import { requirePageCapability } from '@/lib/admin/page-guard'
import { usdToLocal } from '@/lib/currency'
import {
  parseLedgerParams,
  fetchLedger,
  summariseLedger,
  type LedgerParams,
} from '@/lib/admin/finance'
import { TxnStatusBadge, ProviderBadge, TxnTypeBadge } from '@/components/admin/finance/FinanceBadges'
import {
  PageHeader, FilterBar, Field, SearchField, SelectField, ApplyButton,
  TableCard, Table, Th, Td, Pagination, EmptyRow, Kpi,
} from '@/components/admin/ui'
import {
  IconDeposit, IconWithdraw, IconSwap, IconPercent, IconStar, IconUsers,
  IconDownload, IconScroll,
} from '@/components/ui/icons'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Ledger' }

const TYPE_OPTIONS = ['', 'deposit', 'withdrawal', 'bet_placed', 'bet_won', 'bet_lost', 'bet_refunded', 'fee', 'bonus', 'referral_bonus', 'creator_reward']
const STATUS_OPTIONS = ['', 'pending', 'processing', 'completed', 'failed', 'refunded']

const opt = (values: string[], any: string) =>
  values.map((v) => ({ value: v, label: v === '' ? any : v.replace(/_/g, ' ') }))

const usd = (v: number) =>
  'KSh ' + Math.round(usdToLocal(v ?? 0, 'KES')).toLocaleString('en-KE')

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

function qs(p: LedgerParams, o: Partial<LedgerParams>): string {
  const m = { ...p, ...o }
  const sp = new URLSearchParams()
  if (m.type) sp.set('type', m.type)
  if (m.status) sp.set('status', m.status)
  if (m.from) sp.set('from', m.from)
  if (m.to) sp.set('to', m.to)
  if (m.q) sp.set('q', m.q)
  sp.set('page', String(m.page))
  return sp.toString()
}

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requirePageCapability('finance:ledger')
  const params = parseLedgerParams(await searchParams)
  const { rows, total } = await fetchLedger(ctx.supabase, params)
  const summary = summariseLedger(rows as never)

  const kpis = [
    { label: 'Deposits', value: usd(summary.deposits_usd), sub: 'completed inflow', icon: <IconDeposit size={15} /> },
    { label: 'Withdrawals', value: usd(summary.withdrawals_usd), sub: 'completed outflow', icon: <IconWithdraw size={15} /> },
    { label: 'Net flow', value: usd(summary.net_flow_usd), sub: 'deposits − withdrawals', icon: <IconSwap size={15} />, attention: summary.net_flow_usd < 0 },
    { label: 'Fees', value: usd(summary.fees_usd), sub: 'platform fees', icon: <IconPercent size={15} /> },
    { label: 'Creator rewards', value: usd(summary.creator_rewards_usd), sub: 'paid to creators', icon: <IconStar size={15} /> },
    { label: 'Referral bonus', value: usd(summary.referral_bonus_usd), sub: 'referral payouts', icon: <IconUsers size={15} /> },
  ]

  return (
    <div>
      <PageHeader
        title="Ledger"
        description="Every balance-affecting transaction, reconciled and exportable: the platform's book of record."
        crumbs={[{ label: 'Finance', href: '/admin/finance' }, { label: 'Ledger' }]}
        meta={<span>{total.toLocaleString()} transaction{total === 1 ? '' : 's'}</span>}
        actions={
          <a href={`/api/admin/finance/ledger/export?${qs(params, { page: 1 })}`} className="btn btn-secondary btn-sm gap-1.5">
            <IconDownload size={15} /> Export CSV
          </a>
        }
      />

      <div className="mb-2 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-6">
        {kpis.map((k) => (
          <Kpi key={k.label} label={k.label} value={k.value} sub={k.sub} icon={k.icon} tone={k.attention ? 'attention' : 'default'} />
        ))}
      </div>
      <p className="mb-6 text-xs text-[var(--text-muted)]">
        Summary reflects the <span className="font-medium text-[var(--text-secondary)]">{summary.count.toLocaleString()}</span> rows currently loaded.
        Narrow the date range for period reconciliation, then export the full result set.
      </p>

      <FilterBar>
        <SearchField id="q" name="q" defaultValue={params.q ?? ''} placeholder="Search reference…" />
        <SelectField id="type" name="type" label="Type" options={opt(TYPE_OPTIONS, 'Any type')} defaultValue={params.type ?? ''} className="w-40" />
        <SelectField id="status" name="status" label="Status" options={opt(STATUS_OPTIONS, 'Any status')} defaultValue={params.status ?? ''} />
        <Field label="From" htmlFor="from" className="w-40">
          <input id="from" type="date" name="from" defaultValue={params.from ?? ''} className="admin-field" />
        </Field>
        <Field label="To" htmlFor="to" className="w-40">
          <input id="to" type="date" name="to" defaultValue={params.to ?? ''} className="admin-field" />
        </Field>
        <ApplyButton>Filter</ApplyButton>
      </FilterBar>

      <TableCard>
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Type</Th>
              <Th>Status</Th>
              <Th num>Amount</Th>
              <Th num>KES</Th>
              <Th>Provider</Th>
              <Th>Reference</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t: any) => (
              <tr key={t.id}>
                <Td><span className="whitespace-nowrap text-xs text-[var(--text-muted)]">{fmtDate(t.created_at)}</span></Td>
                <Td><TxnTypeBadge type={t.type} /></Td>
                <Td><TxnStatusBadge status={t.status} /></Td>
                <Td num>
                  <span className="tabular-nums text-[var(--text-secondary)]">{Number(t.amount ?? 0).toLocaleString()}</span>
                  <span className="ml-1 text-xs text-[var(--text-muted)]">{t.currency}</span>
                </Td>
                <Td num><span className="font-medium tabular-nums text-[var(--text-primary)]">{usd(Number(t.amount_usd ?? 0))}</span></Td>
                <Td><ProviderBadge provider={t.payment_provider} /></Td>
                <Td><span className="text-xs text-[var(--text-muted)]">{t.payment_reference ?? t.provider_reference ?? '—'}</span></Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <EmptyRow colSpan={7}>
                <span className="inline-flex items-center gap-2"><IconScroll size={16} /> No transactions match these filters.</span>
              </EmptyRow>
            )}
          </tbody>
        </Table>
      </TableCard>

      <Pagination
        page={params.page}
        pageSize={params.pageSize}
        total={total}
        hrefForPage={(p) => `/admin/finance/ledger?${qs(params, { page: p })}`}
      />
    </div>
  )
}
