'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Role } from '@/lib/admin/rbac'
import type { Enums } from '@/types/supabase'

type Status = Enums<'account_status'>

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; error?: string; data?: any }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json.error || `Request failed (${res.status})` }
    return { ok: true, data: json.data ?? json }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

function Feedback({ msg }: { msg: { kind: 'ok' | 'err'; text: string } | null }) {
  if (!msg) return null
  return (
    <p className={'mt-2 text-xs ' + (msg.kind === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400')}>
      {msg.text}
    </p>
  )
}

export function UserActions({
  userId,
  currentRole,
  currentStatus,
  currencies,
  allowedRoles,
  canStatus,
  canBalance,
  canImpersonate,
  canNote,
  immutable,
}: {
  userId: string
  currentRole: Role
  currentStatus: Status
  currencies: string[]
  allowedRoles: Role[]
  canStatus: boolean
  canBalance: boolean
  canImpersonate: boolean
  canNote: boolean
  immutable: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const run = (p: Promise<{ ok: boolean; error?: string }>, okText: string) => {
    setMsg(null)
    p.then((r) => {
      if (r.ok) {
        setMsg({ kind: 'ok', text: okText })
        start(() => router.refresh())
      } else {
        setMsg({ kind: 'err', text: r.error || 'Failed' })
      }
    })
  }

  // Local form state
  const [role, setRole] = useState<string>('')
  const [reason, setReason] = useState('')
  const [ccy, setCcy] = useState(currencies[0] ?? 'KES')
  const [amount, setAmount] = useState('')
  const [adjReason, setAdjReason] = useState('')
  // One idempotency key per distinct adjustment: a double click (or a retry
  // after a network error) replays instead of adjusting twice. Any change to
  // the form, or a completed adjustment, starts a new key (audit 6.8).
  const newAdjKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
  const [adjKey, setAdjKey] = useState(newAdjKey)
  const [note, setNote] = useState('')
  const [impersonateLink, setImpersonateLink] = useState<string | null>(null)

  if (immutable) {
    return (
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-2 font-semibold">Actions</h2>
        <p className="text-sm text-amber-600 dark:text-amber-400">
          👑 This is a superadmin. It is immutable — it cannot be re-roled, suspended, closed, or impersonated.
        </p>
      </section>
    )
  }

  const hasAnyAction = allowedRoles.length > 0 || canStatus || canBalance || canImpersonate || canNote

  return (
    <section className="rounded-2xl border bg-card p-5">
      <h2 className="mb-3 font-semibold">Actions</h2>
      {!hasAnyAction && <p className="text-sm text-muted-foreground">You have no actions available for this user.</p>}

      {/* Role */}
      {allowedRoles.length > 0 && (
        <div className="mb-4">
          <label htmlFor="change-role-current" className="mb-1 block text-xs font-medium text-muted-foreground">Change role (current: {currentRole})</label>
          <div className="flex gap-2">
            <select id="change-role-current" value={role} onChange={(e) => setRole(e.target.value)} className="min-w-0 flex-1 rounded-lg border bg-background px-2 py-2 text-sm">
              <option value="">Select role…</option>
              {allowedRoles.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <button
              disabled={!role || pending}
              onClick={() => run(postJson(`/api/admin/users/${userId}/role`, { role }), `Role changed to ${role}`)}
              className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {/* Status */}
      {canStatus && (
        <div className="mb-4">
          <label htmlFor="account-status-current" className="mb-1 block text-xs font-medium text-muted-foreground">Account status (current: {currentStatus})</label>
          <input id="account-status-current" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="mb-2 w-full rounded-lg border bg-background px-2 py-2 text-sm" />
          <div className="flex flex-wrap gap-2">
            {(['active', 'suspended', 'closed'] as Status[])
              .filter((s) => s !== currentStatus)
              .map((s) => (
                <button
                  key={s}
                  disabled={pending}
                  onClick={() => run(postJson(`/api/admin/users/${userId}/status`, { status: s, reason }), `Status set to ${s}`)}
                  className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                >
                  {s === 'active' ? 'Reactivate' : s === 'suspended' ? 'Suspend' : 'Close'}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Balance */}
      {canBalance && currencies.length > 0 && (
        <div className="mb-4">
          <label htmlFor="adjust-balance" className="mb-1 block text-xs font-medium text-muted-foreground">Adjust balance</label>
          <div className="flex gap-2">
            <select id="adjust-balance" value={ccy} onChange={(e) => { setCcy(e.target.value); setAdjKey(newAdjKey()) }} className="rounded-lg border bg-background px-2 py-2 text-sm">
              {currencies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input value={amount} onChange={(e) => { setAmount(e.target.value); setAdjKey(newAdjKey()) }} type="number" placeholder="± amount" className="min-w-0 flex-1 rounded-lg border bg-background px-2 py-2 text-sm" />
          </div>
          <input value={adjReason} onChange={(e) => { setAdjReason(e.target.value); setAdjKey(newAdjKey()) }} placeholder="Reason (required)" className="mt-2 w-full rounded-lg border bg-background px-2 py-2 text-sm" />
          <button
            disabled={pending || !amount || adjReason.trim().length < 3}
            onClick={() =>
              run(
                postJson(`/api/admin/users/${userId}/adjust-balance`, { currency: ccy, amount: Number(amount), reason: adjReason, idempotency_key: adjKey }).then((r) => {
                  if (r.ok) setAdjKey(newAdjKey())
                  return r
                }),
                'Balance adjusted'
              )
            }
            className="mt-2 w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            Apply adjustment
          </button>
        </div>
      )}

      {/* Impersonate */}
      {canImpersonate && (
        <div className="mb-4">
          <label htmlFor="impersonate-time-boxed" className="mb-1 block text-xs font-medium text-muted-foreground">Impersonate (time-boxed, audited)</label>
          <input id="impersonate-time-boxed" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" className="mb-2 w-full rounded-lg border bg-background px-2 py-2 text-sm" />
          <button
            disabled={pending || reason.trim().length < 3}
            onClick={() =>
              postJson(`/api/admin/users/${userId}/impersonate`, { reason }).then((r) => {
                if (r.ok) {
                  setImpersonateLink(r.data?.action_link ?? null)
                  setMsg({ kind: 'ok', text: 'Impersonation link generated (open in a private window).' })
                } else setMsg({ kind: 'err', text: r.error || 'Failed' })
              })
            }
            className="w-full rounded-lg border border-amber-500/50 px-3 py-2 text-sm font-semibold text-amber-600 hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-400"
          >
            Generate impersonation link
          </button>
          {impersonateLink && (
            <a href={impersonateLink} target="_blank" rel="noreferrer" className="mt-2 block break-all rounded-lg bg-muted p-2 text-xs text-primary hover:underline">
              {impersonateLink}
            </a>
          )}
        </div>
      )}

      {/* Note */}
      {canNote && (
        <div>
          <label htmlFor="add-internal-note" className="mb-1 block text-xs font-medium text-muted-foreground">Add internal note</label>
          <textarea id="add-internal-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="w-full rounded-lg border bg-background px-2 py-2 text-sm" />
          <button
            disabled={pending || note.trim().length === 0}
            onClick={() => run(postJson(`/api/admin/users/${userId}/note`, { note }).then((r) => { if (r.ok) setNote(''); return r }), 'Note added')}
            className="mt-2 w-full rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            Save note
          </button>
        </div>
      )}

      <Feedback msg={msg} />
    </section>
  )
}
