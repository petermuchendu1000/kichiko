'use client'

// Client action panel for a single market. Renders only the actions the
// operator is allowed to perform (computed server-side and passed in), each
// posting to /api/admin/markets/[id]/action. Destructive actions require a
// reason; resolve requires an outcome + notes.
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export type MarketActionKey =
  | 'approve' | 'reject' | 'close' | 'dispute' | 'resolve' | 'cancel' | 'void' | 'feature'

export interface AllowedAction {
  key: MarketActionKey
  label: string
  danger?: boolean
}

const AREA = 'w-full rounded-[10px] border bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--green)] focus:shadow-[0_0_0_3px_var(--green-faint)]'

export function MarketActions({
  marketId,
  actions,
  isFeatured,
  isTrending,
  featuredOrder,
}: {
  marketId: string
  actions: AllowedAction[]
  isFeatured: boolean
  isTrending: boolean
  featuredOrder: number | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [active, setActive] = useState<MarketActionKey | null>(null)
  const [reason, setReason] = useState('')
  const [outcome, setOutcome] = useState<'yes' | 'no'>('yes')
  const [notes, setNotes] = useState('')
  const [voidPrice, setVoidPrice] = useState('0.50')
  const [feat, setFeat] = useState(isFeatured)
  const [trend, setTrend] = useState(isTrending)
  const [order, setOrder] = useState<string>(featuredOrder != null ? String(featuredOrder) : '')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function post(payload: Record<string, unknown>) {
    setErr(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/markets/${marketId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(json.error || 'Action failed')
        return
      }
      setActive(null)
      setReason('')
      setNotes('')
      start(() => router.refresh())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.key}
            disabled={busy || pending}
            onClick={() => {
              setErr(null)
              if (a.key === 'approve' || a.key === 'close') {
                post({ action: a.key })
              } else {
                setActive(active === a.key ? null : a.key)
              }
            }}
            className={`btn btn-sm ${a.danger ? 'btn-secondary text-red-600 dark:text-red-400' : 'btn-secondary'}`}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* Reason-required actions: reject / dispute / cancel */}
      {(active === 'reject' || active === 'dispute' || active === 'cancel') && (
        <div className="flex flex-col gap-2 rounded-[10px] border bg-[var(--bg-secondary)] p-3">
          <label htmlFor="reason" className="text-sm font-medium capitalize text-[var(--text-secondary)]">{active} reason (required)</label>
          <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={AREA} placeholder="Explain why…" />
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => setActive(null)}>Cancel</button>
            <button disabled={busy || reason.trim().length < 3} onClick={() => post({ action: active, reason })} className="btn btn-no btn-sm">
              Confirm {active}
            </button>
          </div>
        </div>
      )}

      {/* Void: conserving settlement at one YES price (NO pays 1 - price). */}
      {active === 'void' && (
        <div className="flex flex-col gap-2 rounded-[10px] border bg-[var(--bg-secondary)] p-3">
          <span className="text-sm font-medium text-[var(--text-secondary)]">
            Void: every YES share settles at the price below, every NO share at 1 minus it. Open orders are cancelled and escrow returned.
          </span>
          <label htmlFor="void-price" className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            YES price (0 to 1)
            <input id="void-price" type="number" min={0} max={1} step={0.01} value={voidPrice} onChange={(e) => setVoidPrice(e.target.value)} className="admin-field ml-1 w-24" />
          </label>
          <label htmlFor="void-reason" className="sr-only">Void reason</label>
          <textarea id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={AREA} placeholder="Why this market cannot be resolved (min 10 chars)" />
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => setActive(null)}>Cancel</button>
            <button
              disabled={busy || reason.trim().length < 10 || !(Number(voidPrice) >= 0 && Number(voidPrice) <= 1) || voidPrice.trim() === ''}
              onClick={() => post({ action: 'void', reason, yes_price: Number(voidPrice) })}
              className="btn btn-no btn-sm"
            >
              Void &amp; settle
            </button>
          </div>
        </div>
      )}

      {/* Resolve: outcome + notes */}
      {active === 'resolve' && (
        <div className="flex flex-col gap-2 rounded-[10px] border bg-[var(--bg-secondary)] p-3">
          <span className="text-sm font-medium text-[var(--text-secondary)]">Resolve outcome</span>
          <div className="flex gap-2">
            {(['yes', 'no'] as const).map((o) => (
              <button key={o} onClick={() => setOutcome(o)} className={`btn btn-sm ${outcome === o ? (o === 'yes' ? 'btn-yes' : 'btn-no') : 'btn-secondary'}`}>
                {o.toUpperCase()}
              </button>
            ))}
          </div>
          <label htmlFor="resolve-notes" className="sr-only">Resolution notes</label>
          <textarea id="resolve-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Resolution notes / source (min 10 chars)" className={AREA} />
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => setActive(null)}>Cancel</button>
            <button disabled={busy || notes.trim().length < 10} onClick={() => post({ action: 'resolve', outcome, resolution_notes: notes })} className="btn btn-yes btn-sm">
              Resolve &amp; pay out
            </button>
          </div>
        </div>
      )}

      {/* Feature / trend toggles */}
      {active === 'feature' && (
        <div className="flex flex-col gap-2.5 rounded-[10px] border bg-[var(--bg-secondary)] p-3">
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={feat} onChange={(e) => setFeat(e.target.checked)} className="accent-[var(--green)]" /> Featured
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={trend} onChange={(e) => setTrend(e.target.checked)} className="accent-[var(--green)]" /> Trending
          </label>
          <label htmlFor="feat-order" className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            Featured order
            <input id="feat-order" type="number" value={order} onChange={(e) => setOrder(e.target.value)} disabled={!feat} className="admin-field ml-1 w-24 disabled:opacity-50" />
          </label>
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => setActive(null)}>Cancel</button>
            <button
              disabled={busy}
              onClick={() => post({ action: 'feature', is_featured: feat, is_trending: trend, featured_order: feat && order !== '' ? Number(order) : null })}
              className="btn btn-primary btn-sm"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
    </div>
  )
}
