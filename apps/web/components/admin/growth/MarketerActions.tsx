'use client'

// Inline marketer lifecycle controls: suspend/reactivate/revoke, regenerate
// tracking code, and edit commission plan. Posts to
// /api/admin/marketers/[id]/action.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { SHARE_PAYOUT_KES } from '@/lib/currency'

const btn = 'rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50'

function useAction(id: string) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function post(payload: Record<string, unknown>) {
    setErr(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/marketers/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(json.error || 'Action failed')
        return false
      }
      start(() => router.refresh())
      return true
    } finally {
      setBusy(false)
    }
  }
  return { post, busy: busy || pending, err }
}

export function MarketerStatusActions({ userId, status }: { userId: string; status: string }) {
  const { post, busy, err } = useAction(userId)
  const [mode, setMode] = useState<'suspend' | 'revoke' | null>(null)
  const [reason, setReason] = useState('')

  if (mode) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="w-52 rounded-lg border bg-background px-2 py-1 text-xs" />
        <div className="flex gap-1.5">
          <button onClick={() => setMode(null)} className={btn + ' border hover:bg-muted'}>Cancel</button>
          <button
            disabled={busy}
            onClick={async () => {
              const ok = await post({ action: 'set_status', status: mode === 'suspend' ? 'suspended' : 'revoked', reason: reason || undefined })
              if (ok) setMode(null)
            }}
            className={btn + ' bg-red-600 text-white hover:opacity-90'}
          >
            Confirm {mode}
          </button>
        </div>
        {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1.5">
        {status !== 'active' && (
          <button disabled={busy} onClick={() => post({ action: 'set_status', status: 'active' })} className={btn + ' border hover:bg-muted'}>Reactivate</button>
        )}
        {status === 'active' && (
          <button disabled={busy} onClick={() => setMode('suspend')} className={btn + ' border border-amber-500/50 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400'}>Suspend</button>
        )}
        {status !== 'revoked' && (
          <button disabled={busy} onClick={() => setMode('revoke')} className={btn + ' border border-red-500/50 text-red-600 hover:bg-red-500/10 dark:text-red-400'}>Revoke</button>
        )}
      </div>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </div>
  )
}

export function RegenCodeButton({ userId }: { userId: string }) {
  const { post, busy, err } = useAction(userId)
  return (
    <div className="flex flex-col gap-1">
      <button disabled={busy} onClick={() => post({ action: 'regen_code' })} className={btn + ' border hover:bg-muted'}>
        Regenerate code
      </button>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </div>
  )
}

export function MarketerPlanForm({
  userId,
  current,
}: {
  userId: string
  current: { model: string; cpa_usd: number; revshare_pct: number; hold_days: number }
}) {
  const { post, busy, err } = useAction(userId)
  const [model, setModel] = useState(current.model)
  // CPA is stored as a peg unit (*_usd); show/edit it in KES.
  const [cpa, setCpa] = useState(String(current.cpa_usd * SHARE_PAYOUT_KES))
  const [rev, setRev] = useState(String(current.revshare_pct))
  const [hold, setHold] = useState(String(current.hold_days))

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <h3 className="text-sm font-semibold">Commission plan</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value)} className="rounded-lg border bg-background px-2 py-1.5 text-sm">
            <option value="cpa">CPA (per activation)</option>
            <option value="revshare">Rev-share (% of fees)</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Hold days</span>
          <input value={hold} onChange={(e) => setHold(e.target.value)} className="rounded-lg border bg-background px-2 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">CPA per activation (KES)</span>
          <input value={cpa} onChange={(e) => setCpa(e.target.value)} disabled={model === 'revshare'} className="rounded-lg border bg-background px-2 py-1.5 text-sm disabled:opacity-50" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Rev-share (%)</span>
          <input value={rev} onChange={(e) => setRev(e.target.value)} disabled={model === 'cpa'} className="rounded-lg border bg-background px-2 py-1.5 text-sm disabled:opacity-50" />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button
          disabled={busy}
          onClick={() =>
            post({
              action: 'update_plan',
              plan: { model, cpa_usd: (Number(cpa) || 0) / SHARE_PAYOUT_KES, revshare_pct: Number(rev) || 0, hold_days: Number(hold) || 0 },
              hold_days: Number(hold) || 0,
            })
          }
          className={btn + ' bg-primary text-primary-foreground hover:opacity-90'}
        >
          Save plan
        </button>
        {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
      </div>
    </div>
  )
}
