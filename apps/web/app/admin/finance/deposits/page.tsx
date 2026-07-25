// app/admin/finance/deposits/page.tsx — Deposits console: filter, inspect and
// reconcile inbound payments on the shared admin UI kit.
import Link from 'next/link'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { parsePaymentListParams, fetchDeposits, type PaymentListParams } from '@/lib/admin/finance'
import { TxnStatusBadge, ProviderBadge } from '@/components/admin/finance/FinanceBadges'
import { DepositActions } from '@/components/admin/finance/DepositActions'
import {
  PageHeader, FilterBar, SearchField, SelectField, ApplyButton,
  TableCard, Table, Th, Td, Pagination, EmptyRow,
} from '@/components/admin/ui'
import { IconDeposit } from '@/components/ui/icons'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Deposits' }

const STATUS_OPTIONS = ['', 'pending', 'processing', 'completed', 'failed', 'refunded']
const PROVIDER_OPTIONS = ['', 'mpesa', 'mtn_momo', 'airtel_money', 'pesapal', 'bank_transfer', 'internal']

const opt = (values: string[], any: string) =>
  values.map((v) => ({ value: v, label: v === '' ? any : v.replace(/_/g, ' ') }))

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

function qs(p: PaymentListParams, o: Partial<PaymentListParams>): string {
  const m = { ...p, ...o }
  const sp = new URLSearchParams()
  if (m.status) sp.set('status', m.status)
  if (m.provider) sp.set('provider', m.provider)
  if (m.q) sp.set('q', m.q)
  sp.set('page', String(m.page))
  return sp.toString()
}

export default async function DepositsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requirePageCapability('finance:deposits')
  const params = parsePaymentListParams(await searchParams)
  const { rows, total } = await fetchDeposits(ctx.supabase, params)

  return (
    <div>
      <PageHeader
        title="Deposits"
        description="Inbound payments across every rail — inspect receipts and reconcile."
        crumbs={[{ label: 'Finance', href: '/admin/finance' }, { label: 'Deposits' }]}
        meta={<span>{total.toLocaleString()} deposit{total === 1 ? '' : 's'}</span>}
      />

      <FilterBar>
        <SearchField id="q" name="q" defaultValue={params.q ?? ''} placeholder="Search phone number…" />
        <SelectField id="status" name="status" label="Status" options={opt(STATUS_OPTIONS, 'Any status')} defaultValue={params.status ?? ''} />
        <SelectField id="provider" name="provider" label="Provider" options={opt(PROVIDER_OPTIONS, 'Any provider')} defaultValue={params.provider ?? ''} className="w-44" />
        <ApplyButton>Filter</ApplyButton>
      </FilterBar>

      <TableCard>
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>User</Th>
              <Th>Provider</Th>
              <Th num>Amount</Th>
              <Th>Status</Th>
              <Th>Receipt / reason</Th>
              <Th num>Reconcile</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d: any) => (
              <tr key={d.id}>
                <Td><span className="whitespace-nowrap text-xs text-[var(--text-muted)]">{fmtDate(d.created_at)}</span></Td>
                <Td>
                  <Link href={`/admin/users/${d.user_id}`} className="font-medium text-[var(--text-primary)] hover:text-[var(--green)]">
                    {d.user?.username ?? '—'}
                  </Link>
                  <div className="mt-0.5 text-xs text-[var(--text-muted)] tabular-nums">{d.phone_number ?? '—'}</div>
                </Td>
                <Td><ProviderBadge provider={d.provider} /></Td>
                <Td num>
                  <span className="font-medium tabular-nums text-[var(--text-primary)]">{Number(d.amount ?? 0).toLocaleString()}</span>
                  <span className="ml-1 text-xs text-[var(--text-muted)]">{d.currency}</span>
                </Td>
                <Td><TxnStatusBadge status={d.status} /></Td>
                <Td>
                  <span className={`text-xs ${d.failure_reason ? 'text-red-600 dark:text-red-400' : 'text-[var(--text-muted)]'}`}>
                    {d.provider_receipt ?? d.failure_reason ?? '—'}
                  </span>
                </Td>
                <Td num><DepositActions id={d.id} status={d.status} /></Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <EmptyRow colSpan={7}>
                <span className="inline-flex items-center gap-2"><IconDeposit size={16} /> No deposits match these filters.</span>
              </EmptyRow>
            )}
          </tbody>
        </Table>
      </TableCard>

      <Pagination
        page={params.page}
        pageSize={params.pageSize}
        total={total}
        hrefForPage={(p) => `/admin/finance/deposits?${qs(params, { page: p })}`}
      />
    </div>
  )
}
