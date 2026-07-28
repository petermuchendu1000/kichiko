'use client'

// Create a promo campaign + inline pause/resume/end controls. Posts to
// /api/admin/campaigns and /api/admin/campaigns/[id]/action.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { localToUsd } from '@/lib/currency'
import { useRates } from '@/hooks/use-rates'

const btn = 'rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50'

export function CampaignCreate() {
  const router = useRouter()
  const { rates } = useRates()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [f, setF] = useState({ code: '', label: '', kind: 'deposit_bonus', value_pct: '10', budget_usd: '', max_value_usd: '', max_redemptions: '', per_user_limit: '1' })
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }))

  async function submit() {
    setErr(null)
    setBusy(true)
    try {
      const res = await fetch('/api/admin/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: f.code,
          label: f.label,
          kind: f.kind,
          value_pct: Number(f.value_pct) || 0,
          // Admin enters KES; stored *_usd columns are true USD, so convert
          // KES -> USD at the live FX rate on the way in.
          budget_usd: f.budget_usd.trim() === '' ? null : localToUsd(Number(f.budget_usd), 'KES', rates),
          max_value_usd: f.max_value_usd.trim() === '' ? null : localToUsd(Number(f.max_value_usd), 'KES', rates),
          max_redemptions: f.max_redemptions.trim() === '' ? null : Number(f.max_redemptions),
          per_user_limit: Number(f.per_user_limit) || 1,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(json.error || 'Failed')
        return
      }
      setOpen(false)
      setF({ code: '', label: '', kind: 'deposit_bonus', value_pct: '10', budget_usd: '', max_value_usd: '', max_redemptions: '', per_user_limit: '1' })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={btn + ' bg-primary px-3 py-2 text-primary-foreground hover:opacity-90'}>
        + New campaign
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <h3 className="text-sm font-semibold">New campaign</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <input value={f.code} onChange={(e) => set('code', e.target.value)} placeholder="Code (e.g. WELCOME50)" className="rounded-lg border bg-background px-2 py-1.5 text-sm" />
        <input value={f.label} onChange={(e) => set('label', e.target.value)} placeholder="Label" className="rounded-lg border bg-background px-2 py-1.5 text-sm" />
        <select value={f.kind} onChange={(e) => set('kind', e.target.value)} className="rounded-lg border bg-background px-2 py-1.5 text-sm">
          <option value="deposit_bonus">Deposit bonus</option>
          <option value="fee_discount">Fee discount</option>
        </select>
        <label className="flex flex-col gap-1 text-xs"><span className="text-muted-foreground">Value %</span>
          <input value={f.value_pct} onChange={(e) => set('value_pct', e.target.value)} className="rounded-lg border bg-background px-2 py-1.5 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs"><span className="text-muted-foreground">Per-redemption cap KES</span>
          <input value={f.max_value_usd} onChange={(e) => set('max_value_usd', e.target.value)} placeholder="blank = uncapped" className="rounded-lg border bg-background px-2 py-1.5 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs"><span className="text-muted-foreground">Total budget KES</span>
          <input value={f.budget_usd} onChange={(e) => set('budget_usd', e.target.value)} placeholder="blank = uncapped" className="rounded-lg border bg-background px-2 py-1.5 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs"><span className="text-muted-foreground">Max redemptions</span>
          <input value={f.max_redemptions} onChange={(e) => set('max_redemptions', e.target.value)} placeholder="blank = unlimited" className="rounded-lg border bg-background px-2 py-1.5 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs"><span className="text-muted-foreground">Per-user limit</span>
          <input value={f.per_user_limit} onChange={(e) => set('per_user_limit', e.target.value)} className="rounded-lg border bg-background px-2 py-1.5 text-sm" /></label>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => setOpen(false)} className={btn + ' border hover:bg-muted'}>Cancel</button>
        <button disabled={busy || f.code.trim().length < 2} onClick={submit} className={btn + ' bg-primary text-primary-foreground hover:opacity-90'}>Create</button>
        {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
      </div>
    </div>
  )
}

export function CampaignStatusActions({ id, status }: { id: string; status: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function post(next: string) {
    setErr(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/campaigns/${id}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(json.error || 'Failed')
        return
      }
      start(() => router.refresh())
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1.5">
        {status === 'active' && <button disabled={busy || pending} onClick={() => post('paused')} className={btn + ' border hover:bg-muted'}>Pause</button>}
        {status === 'paused' && <button disabled={busy || pending} onClick={() => post('active')} className={btn + ' border hover:bg-muted'}>Resume</button>}
        {status !== 'ended' && <button disabled={busy || pending} onClick={() => post('ended')} className={btn + ' border border-red-500/50 text-red-600 hover:bg-red-500/10 dark:text-red-400'}>End</button>}
      </div>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
    </div>
  )
}
