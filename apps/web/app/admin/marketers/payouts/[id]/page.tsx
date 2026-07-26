// app/admin/marketers/payouts/[id]/page.tsx — Payout run detail & item ledger.
import Link from 'next/link'
import { kes2 } from '@/lib/admin/money'
import { notFound } from 'next/navigation'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { runActions, summariseRun, type ItemLike, type RunStatus } from '@/lib/admin/payouts'
import { RunStatusBadge, KindBadge, ItemStatusBadge, SettlementBadge } from '@/components/admin/growth/Badges'
import { PayoutRunActions, ClawbackButton } from '@/components/admin/growth/PayoutActions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Payout Run' }

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-black tabular-nums">{value}</div>
    </div>
  )
}

export default async function PayoutRunDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requirePageCapability('payouts:run')
  const sb = ctx.supabase

  const { data: run } = await sb
    .from('payout_runs')
    .select('id, kind, period_start, period_end, status, total_usd, notes, created_at, computed_at, approved_at, disbursed_at')
    .eq('id', id)
    .single()
  if (!run) notFound()

  const { data: items } = await sb
    .from('payout_items')
    .select('id, user_id, amount_usd, settlement, status, eligible_at, tx_count, created_at, profiles!payout_items_user_id_fkey(username, display_name)')
    .eq('run_id', id)
    .order('amount_usd', { ascending: false })

  const summary = summariseRun((items ?? []) as unknown as ItemLike[])
  const actions = runActions(run.status as RunStatus)
  const usd = (n: number | string) => kes2(n)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/marketers/payouts" className="text-sm text-muted-foreground hover:underline">← Payout runs</Link>
        <h1 className="text-2xl font-black">Payout run</h1>
        <KindBadge kind={run.kind} />
        <RunStatusBadge status={run.status} />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <span>Period {run.period_start} → {run.period_end}</span>
        <span>· Created {new Date(run.created_at).toLocaleString()}</span>
        {run.disbursed_at && <span>· Disbursed {new Date(run.disbursed_at).toLocaleString()}</span>}
        <a href={`/api/admin/payouts/${id}/export`} className="text-primary hover:underline">Export statement CSV →</a>
      </div>

      <div className="card-grid grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total payable" value={usd(summary.payableUsd)} />
        <Stat label="Paid" value={usd(summary.paidUsd)} />
        <Stat label="Held" value={usd(summary.heldUsd)} />
        <Stat label="Items" value={String(summary.itemCount)} />
      </div>

      <PayoutRunActions id={id} actions={actions} />

      <div className="table-wrapper overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="px-3 py-2">Beneficiary</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Settlement</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Eligible</th><th className="px-3 py-2 text-right">Src txns</th><th className="px-3 py-2 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {(items ?? []).length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">No items — compute the run to populate.</td></tr>}
            {(items ?? []).map((it) => {
              const p = it.profiles as unknown as { username: string | null; display_name: string | null } | null
              return (
                <tr key={it.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2"><Link href={`/admin/users/${it.user_id}`} className="text-primary hover:underline">{p?.username ?? it.user_id.slice(0, 8)}</Link></td>
                  <td className="px-3 py-2 text-right tabular-nums">{usd(it.amount_usd)}</td>
                  <td className="px-3 py-2"><SettlementBadge settlement={it.settlement} /></td>
                  <td className="px-3 py-2"><ItemStatusBadge status={it.status} /></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{it.eligible_at ? new Date(it.eligible_at).toLocaleDateString() : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{it.tx_count}</td>
                  <td className="px-3 py-2 text-right">{it.status === 'paid' ? <ClawbackButton itemId={it.id} /> : <span className="text-xs text-muted-foreground">—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
