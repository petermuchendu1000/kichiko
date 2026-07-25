// app/admin/finance/page.tsx — Finance control tower: live treasury signals +
// entry points into the deposit, withdrawal and ledger consoles.
import Link from 'next/link'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { roleHasCapability } from '@/lib/admin/rbac'
import { PageHeader, KpiGrid, Kpi } from '@/components/admin/ui'
import {
  IconWithdraw, IconDeposit, IconAlertTriangle, IconRefresh,
  IconScroll, IconArrowRight, IconWallet,
} from '@/components/ui/icons'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Finance' }

async function count(supabase: any, table: string, build: (q: any) => any): Promise<number> {
  const { count } = await build(supabase.from(table).select('id', { count: 'exact', head: true }))
  return count ?? 0
}

export default async function FinancePage() {
  const ctx = await requirePageCapability(['finance:ledger', 'finance:deposits', 'finance:withdrawals'])
  const sb = ctx.supabase

  const [pendingWd, reviewWd, failedWd, pendingDep] = await Promise.all([
    count(sb, 'withdrawals', (q) => q.in('status', ['pending', 'processing'])),
    count(sb, 'withdrawals', (q) => q.eq('requires_review', true).in('status', ['pending', 'processing'])),
    count(sb, 'withdrawals', (q) => q.eq('status', 'failed')),
    count(sb, 'deposits', (q) => q.in('status', ['pending', 'processing'])),
  ])

  const num = (n: number) => n.toLocaleString()

  const cards = [
    {
      label: 'Withdrawals in flight', value: pendingWd, icon: <IconWithdraw size={15} />,
      sub: 'pending or processing', href: '/admin/finance/withdrawals?status=processing',
      cap: 'finance:withdrawals', alert: false,
    },
    {
      label: 'Awaiting review', value: reviewWd, icon: <IconAlertTriangle size={15} />,
      sub: reviewWd > 0 ? 'needs a decision' : 'queue clear', href: '/admin/finance/withdrawals',
      cap: 'finance:withdrawals', alert: reviewWd > 0,
    },
    {
      label: 'Failed withdrawals', value: failedWd, icon: <IconRefresh size={15} />,
      sub: failedWd > 0 ? 'retry or refund' : 'none failing', href: '/admin/finance/withdrawals?status=failed',
      cap: 'finance:withdrawals', alert: failedWd > 0,
    },
    {
      label: 'Deposits in flight', value: pendingDep, icon: <IconDeposit size={15} />,
      sub: 'pending or processing', href: '/admin/finance/deposits?status=processing',
      cap: 'finance:deposits', alert: false,
    },
  ].filter((c) => roleHasCapability(ctx.role, c.cap as never))

  const consoles = [
    { label: 'Deposits', desc: 'Inspect, confirm and reconcile inbound payments.', href: '/admin/finance/deposits', cap: 'finance:deposits', icon: <IconDeposit size={18} /> },
    { label: 'Withdrawals', desc: 'Approve, reject, retry and complete payouts.', href: '/admin/finance/withdrawals', cap: 'finance:withdrawals', icon: <IconWithdraw size={18} /> },
    { label: 'Ledger', desc: 'Unified transactions, reconciliation and CSV export.', href: '/admin/finance/ledger', cap: 'finance:ledger', icon: <IconScroll size={18} /> },
  ].filter((c) => roleHasCapability(ctx.role, c.cap as never))

  const attention = reviewWd + failedWd

  return (
    <div>
      <PageHeader
        title="Finance"
        description="Treasury operations: money in, money out, and the reconciled ledger of record."
        meta={
          <span className="inline-flex items-center gap-1.5">
            <IconWallet size={13} />
            {attention > 0
              ? <><span className="font-medium text-amber-600 dark:text-amber-400">{num(attention)}</span> item{attention === 1 ? '' : 's'} need attention</>
              : 'All queues clear'}
          </span>
        }
      />

      {cards.length > 0 && (
        <KpiGrid className="mb-8">
          {cards.map((c) => (
            <Kpi
              key={c.label}
              label={c.label}
              value={num(c.value)}
              sub={c.sub}
              icon={c.icon}
              href={c.href}
              tone={c.alert ? 'attention' : 'default'}
            />
          ))}
        </KpiGrid>
      )}

      <h2 className="mb-3 text-[0.7rem] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Consoles</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {consoles.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="admin-panel group flex items-start gap-3.5 p-4 transition-colors hover:border-[var(--green)]/40"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] transition-colors group-hover:text-[var(--green)]">
              {c.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 font-medium text-[var(--text-primary)]">
                {c.label}
                <IconArrowRight size={14} className="opacity-0 transition-opacity group-hover:opacity-60" />
              </span>
              <span className="mt-0.5 block text-sm text-[var(--text-muted)]">{c.desc}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
