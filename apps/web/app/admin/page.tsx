// app/admin/page.tsx — Control-plane dashboard.
// Operational at a glance: headline KPIs, a triage grid of work queues, and a
// live activity feed. Every queue links straight to the console that clears it.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAuthContext } from '@/lib/auth'
import { canAccessAdminPortal } from '@/lib/admin/rbac'
import { buildRatesMap } from '@/lib/currency'
import { kes } from '@/lib/admin/money'
import { PageHeader, Kpi, KpiGrid, Panel, PanelHead, Table, Th, Td, EmptyRow, Pill } from '@/components/admin/ui'
import {
  IconUsers, IconMarkets, IconWallet, IconShield, IconFlag, IconGavel,
  IconDeposit, IconWithdraw, IconArrowRight, IconActivity,
} from '@/components/ui/icons'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Dashboard' }

async function count(sb: any, table: string, build: (q: any) => any): Promise<number> {
  try {
    const { count } = await build(sb.from(table).select('id', { count: 'exact', head: true }))
    return count ?? 0
  } catch {
    return 0
  }
}

export default async function AdminDashboard() {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/auth/login?next=/admin')
  if (!canAccessAdminPortal(ctx.role)) redirect('/')
  const sb = ctx.supabase

  const [
    totalUsers, activeMarkets, pendingMarkets, disputedMarkets,
    pendingKyc, depositsInFlight, withdrawalsReview, openReports, recentRes,
  ] = await Promise.all([
    count(sb, 'profiles', (q) => q),
    count(sb, 'markets', (q) => q.eq('status', 'active')),
    count(sb, 'markets', (q) => q.eq('status', 'pending')),
    count(sb, 'markets', (q) => q.eq('status', 'disputed')),
    count(sb, 'kyc_documents', (q) => q.eq('status', 'pending')),
    count(sb, 'deposits', (q) => q.in('status', ['pending', 'processing'])),
    count(sb, 'withdrawals', (q) => q.eq('requires_review', true).in('status', ['pending', 'processing'])),
    count(sb, 'content_reports', (q) => q.in('status', ['open', 'reviewing'])),
    sb.from('transactions').select('*').eq('type', 'bet_placed').order('created_at', { ascending: false }).limit(8),
  ])

  const recent = (recentRes?.data ?? []) as Array<{
    id: string; user_id: string; description: string | null; amount_usd: number; created_at: string | null
  }>

  const queues = [
    { label: 'Markets awaiting review', value: pendingMarkets, href: '/admin/markets?status=pending', icon: <IconMarkets size={18} />, tone: 'amber' as const },
    { label: 'Disputed markets', value: disputedMarkets, href: '/admin/markets/disputes', icon: <IconGavel size={18} />, tone: 'red' as const },
    { label: 'KYC pending verification', value: pendingKyc, href: '/admin/kyc', icon: <IconShield size={18} />, tone: 'blue' as const },
    { label: 'Deposits in flight', value: depositsInFlight, href: '/admin/finance/deposits?status=processing', icon: <IconDeposit size={18} />, tone: 'slate' as const },
    { label: 'Withdrawals to review', value: withdrawalsReview, href: '/admin/finance/withdrawals?status=processing', icon: <IconWithdraw size={18} />, tone: 'amber' as const },
    { label: 'Open moderation reports', value: openReports, href: '/admin/moderation?status=open', icon: <IconFlag size={18} />, tone: 'red' as const },
  ]

  const toneClasses: Record<string, string> = {
    amber: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
    red: 'text-red-600 dark:text-red-400 bg-red-500/10',
    blue: 'text-blue-600 dark:text-blue-400 bg-blue-500/10',
    slate: 'text-slate-600 dark:text-slate-300 bg-slate-500/10',
  }

  // Single canonical money formatter, converting internal USD at the LIVE FX
  // rate read from exchange_rates (no duplicated per-page conversion math).
  const { data: rateRows } = await sb.from('exchange_rates').select('from_currency, rate').eq('to_currency', 'USD')
  const rates = buildRatesMap((rateRows as Array<{ from_currency: string; rate: number | string | null }>) ?? [])
  const fmtMoney = (n: number) => kes(n, rates)

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Live health of the platform and everything waiting on an operator."
      />

      {/* Headline KPIs */}
      <KpiGrid className="mb-8">
        <Kpi label="Total users" value={totalUsers.toLocaleString()} icon={<IconUsers size={18} />} href="/admin/users" sub="All registered accounts" />
        <Kpi label="Active markets" value={activeMarkets.toLocaleString()} icon={<IconMarkets size={18} />} href="/admin/markets?status=active" sub="Currently trading" />
        <Kpi label="Awaiting review" value={pendingMarkets.toLocaleString()} icon={<IconGavel size={18} />} href="/admin/markets?status=pending" tone={pendingMarkets > 0 ? 'attention' : 'default'} sub="Markets pending approval" />
        <Kpi label="Open reports" value={openReports.toLocaleString()} icon={<IconFlag size={18} />} href="/admin/moderation?status=open" tone={openReports > 0 ? 'attention' : 'default'} sub="Moderation workload" />
      </KpiGrid>

      {/* Work queues */}
      <div className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Operational queues</h2>
          <span className="text-xs text-[var(--text-muted)]">Sorted by where attention is needed</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {queues.map((q) => (
            <Link key={q.href} href={q.href} className="admin-panel group flex items-center gap-4 p-4 transition-colors hover:border-[var(--border-hover)]">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${toneClasses[q.tone]}`}>
                {q.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="admin-kpi-value text-xl text-[var(--text-primary)]">{q.value.toLocaleString()}</span>
                  {q.value > 0 && <Pill tone={q.tone === 'slate' ? 'neutral' : q.tone} dot>Needs action</Pill>}
                </div>
                <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{q.label}</p>
              </div>
              <IconArrowRight size={16} className="shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </div>

      {/* Recent activity */}
      <Panel>
        <PanelHead
          title="Recent trading activity"
          description="Latest bets placed across all markets"
          actions={<Link href="/admin/finance/ledger" className="btn btn-ghost btn-sm gap-1">Full ledger <IconArrowRight size={13} /></Link>}
        />
        <div className="table-wrapper overflow-x-auto">
          <Table>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Activity</Th>
                <Th num>Amount</Th>
                <Th>Time</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((tx) => (
                <tr key={tx.id}>
                  <Td><span className="font-mono text-xs text-[var(--text-secondary)]">{tx.user_id.slice(0, 8)}</span></Td>
                  <Td><span className="text-[var(--text-secondary)]">{tx.description || 'Bet placed'}</span></Td>
                  <Td num><span className="font-medium tabular-nums">{fmtMoney(tx.amount_usd)}</span></Td>
                  <Td>
                    <span className="text-xs text-[var(--text-muted)]">
                      {tx.created_at ? new Date(tx.created_at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                    </span>
                  </Td>
                </tr>
              ))}
              {recent.length === 0 && (
                <EmptyRow colSpan={4}>
                  <span className="inline-flex items-center gap-2"><IconActivity size={15} /> No recent activity.</span>
                </EmptyRow>
              )}
            </tbody>
          </Table>
        </div>
      </Panel>
    </div>
  )
}
