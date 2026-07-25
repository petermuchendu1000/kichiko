// app/admin/marketers/payouts/page.tsx — Payout runs list + create.
import Link from 'next/link'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { defaultPeriod } from '@/lib/admin/payouts'
import { RunStatusBadge, KindBadge } from '@/components/admin/growth/Badges'
import { PayoutRunCreate } from '@/components/admin/growth/PayoutActions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Payout Runs' }

export default async function PayoutRunsPage() {
  const ctx = await requirePageCapability('payouts:run')
  const sb = ctx.supabase

  const { data: runs } = await sb
    .from('payout_runs')
    .select('id, kind, period_start, period_end, status, total_usd, created_at, disbursed_at')
    .order('created_at', { ascending: false })
    .limit(100)

  const period = defaultPeriod()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/marketers" className="text-sm text-muted-foreground hover:underline">← Marketers</Link>
          <h1 className="text-2xl font-black">Payout Runs</h1>
        </div>
      </div>

      <PayoutRunCreate defaultStart={period.start} defaultEnd={period.end} />

      <p className="text-xs text-muted-foreground">
        Marketer runs accrue commissions and credit wallets on disbursement. Creator runs are statements over
        rewards already credited by trading — no double payment.
      </p>

      <div className="table-wrapper overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="px-3 py-2">Created</th><th className="px-3 py-2">Kind</th><th className="px-3 py-2">Period</th><th className="px-3 py-2 text-right">Total USD</th><th className="px-3 py-2">Status</th><th className="px-3 py-2 text-right"></th></tr>
          </thead>
          <tbody>
            {(runs ?? []).length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">No payout runs yet.</td></tr>}
            {(runs ?? []).map((r) => (
              <tr key={r.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-3 py-2"><KindBadge kind={r.kind} /></td>
                <td className="px-3 py-2 text-xs">{r.period_start} → {r.period_end}</td>
                <td className="px-3 py-2 text-right tabular-nums">${Number(r.total_usd).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                <td className="px-3 py-2"><RunStatusBadge status={r.status} /></td>
                <td className="px-3 py-2 text-right"><Link href={`/admin/marketers/payouts/${r.id}`} className="text-primary hover:underline">Open →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
