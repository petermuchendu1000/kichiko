// app/admin/finance/withdrawals/page.tsx — Withdrawals console: approve / reject
// / retry / complete payouts on the shared admin UI kit.
import Link from 'next/link'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { parsePaymentListParams, fetchWithdrawals, type PaymentListParams } from '@/lib/admin/finance'
import { TxnStatusBadge, ProviderBadge } from '@/components/admin/finance/FinanceBadges'
import { WithdrawalActions } from '@/components/admin/finance/WithdrawalActions'
import {
  PageHeader, FilterBar, SearchField, SelectField, ApplyButton,
  TableCard, Table, Th, Td, Pagination, EmptyRow, Pill,
} from '@/components/admin/ui'
import { IconWithdraw, IconAlertTriangle } from '@/components/ui/icons'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Withdrawals' }

const STATUS_OPTIONS = ['', 'pending', 'processing', 'completed', 'failed', 'refunded']
const PROVIDER_OPTIONS = ['', 'mpesa', 'mtn_momo', 'airtel_money', 'pesapal', 'bank_transfer', 'internal']

const opt = (values: string[], any: string) =>
  values.map((v) => ({ value: v, label: v === '' ? any : v.replace(/_/g, ' ') }))

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

// Withdrawal amounts are stored natively in KES; render as KSh directly.
const kes = (n: number | string | null | undefined) =>
  'KSh ' + Math.round(Number(n ?? 0)).toLocaleString('en-KE')

function qs(p: PaymentListParams, o: Partial<PaymentListParams>): string {
  const m = { ...p, ...o }
  const sp = new URLSearchParams()
  if (m.status) sp.set('status', m.status)
  if (m.provider) sp.set('provider', m.provider)
  if (m.q) sp.set('q', m.q)
  sp.set('page', String(m.page))
  return sp.toString()
}

export default async function WithdrawalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requirePageCapability('finance:withdrawals')
  const params = parsePaymentListParams(await searchParams)
  const { rows, total } = await fetchWithdrawals(ctx.supabase, params)

  return (
    <div>
      <PageHeader
        title="Withdrawals"
        description="Outbound payouts — approve, reject, retry and complete, with reserved-balance safety."
        crumbs={[{ label: 'Finance', href: '/admin/finance' }, { label: 'Withdrawals' }]}
        meta={<span>{total.toLocaleString()} withdrawal{total === 1 ? '' : 's'}</span>}
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
              <Th num>Net</Th>
              <Th>Status</Th>
              <Th num>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w: any) => (
              <tr key={w.id}>
                <Td><span className="whitespace-nowrap text-xs text-[var(--text-muted)]">{fmtDate(w.created_at)}</span></Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    <Link href={`/admin/users/${w.user_id}`} className="font-medium text-[var(--text-primary)] hover:text-[var(--green)]">
                      {w.user?.username ?? '—'}
                    </Link>
                    {w.requires_review && (
                      <Pill tone="amber"><IconAlertTriangle size={10} /> Review</Pill>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--text-muted)] tabular-nums">{w.phone_number ?? '—'}</div>
                </Td>
                <Td><ProviderBadge provider={w.provider} /></Td>
                <Td num>
                  <span className="font-medium tabular-nums text-[var(--text-primary)]">{kes(w.amount)}</span>
                </Td>
                <Td num><span className="tabular-nums text-[var(--text-secondary)]">{kes(w.net_amount)}</span></Td>
                <Td><TxnStatusBadge status={w.status} /></Td>
                <Td num><WithdrawalActions id={w.id} status={w.status} /></Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <EmptyRow colSpan={7}>
                <span className="inline-flex items-center gap-2"><IconWithdraw size={16} /> No withdrawals match these filters.</span>
              </EmptyRow>
            )}
          </tbody>
        </Table>
      </TableCard>

      <Pagination
        page={params.page}
        pageSize={params.pageSize}
        total={total}
        hrefForPage={(p) => `/admin/finance/withdrawals?${qs(params, { page: p })}`}
      />
    </div>
  )
}
