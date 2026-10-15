'use client'

// components/account/play-limits.tsx — deposit and loss limits, set here.
//
// Ruling I2, and L.N. 112 Reg. 84. What this replaces is a sentence saying
// "For deposit or loss limits, contact us via the Help page while we finish
// building them": an email, a wait, and a human, for the one control that has
// to be reachable in the moment someone decides they want it.
//
// THREE THINGS THIS SAYS OUT LOUD that neither incumbent does. Polymarket has
// no responsible-gambling link at all [PM P14]; Kalshi offers a monthly
// deposit cap whose increases apply "next month" without saying what the
// figure counts [KA #17].
//
//   1. WHAT THE LOSS LIMIT COUNTS. Money out and not back in the period, with
//      positions still open counted as if they lost — so the figure is the
//      most you can be down, and it binds when you place the order rather
//      than when the market settles months later. A realised-loss cap would
//      be an ornament here.
//   2. THE ASYMMETRY, BEFORE IT BITES. Lowering is immediate; raising waits
//      24 hours and then needs confirming. Said on the way in, not discovered
//      on the way out.
//   3. WHAT IS LEFT, as a number and a bar, not just the limit.
//
// The amount is a free-text field. A ladder of presets (Kalshi's shape) makes
// the operator's convenient numbers the easy answer; someone who knows their
// own budget should be able to type it.
import { useCallback, useEffect, useState } from 'react'
import { formatCurrency } from '@/lib/currency'
import type { CurrencyCode } from '@/types'

type Kind = 'deposit' | 'loss'
type Period = 'day' | 'week' | 'month'

interface PendingChange {
  id: string
  amount: number | null
  effective_at: string
  confirmable: boolean
}

interface LimitRow {
  kind: Kind
  period: Period
  amount: number | null
  currency: CurrencyCode
  used: number | null
  pending: PendingChange | null
}

const PERIOD_LABEL: Record<Period, string> = {
  day: 'last 24 hours',
  week: 'last 7 days',
  month: 'last 30 days',
}

const PERIOD_CHOICE: { key: Period; label: string }[] = [
  { key: 'day', label: 'Per 24 hours' },
  { key: 'week', label: 'Per 7 days' },
  { key: 'month', label: 'Per 30 days' },
]

const KIND_COPY: Record<Kind, { title: string; what: string }> = {
  deposit: {
    title: 'Deposit limit',
    what: 'The most you can add to your account in the period. Counts deposits as soon as they are requested.',
  },
  loss: {
    title: 'Loss limit',
    what: 'The most you can be down in the period. Open positions count as if they lost, so the cap holds from the moment you place an order — not from when the market settles.',
  },
}

/** "in 23 hours" / "in 40 minutes" / "now" — for the 24-hour wait. */
function waitLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (Number.isNaN(ms) || ms <= 0) return 'now'
  const h = Math.floor(ms / 3_600_000)
  if (h >= 1) return `in ${h} hour${h === 1 ? '' : 's'}`
  const m = Math.max(1, Math.round(ms / 60_000))
  return `in ${m} minute${m === 1 ? '' : 's'}`
}

function money(n: number | null, currency: CurrencyCode): string {
  if (n == null) return '—'
  return formatCurrency(n, currency, { decimals: currency === 'USD' ? 2 : 0 })
}

export function PlayLimits() {
  const [rows, setRows] = useState<LimitRow[]>([])
  // The account's settlement currency, from the same call: a period with no
  // limit yet has no currency of its own, and the form must not guess.
  const [currency, setCurrency] = useState<CurrencyCode>('KES')
  const [loading, setLoading] = useState(true)
  const [unreadable, setUnreadable] = useState(false)
  // /legal/responsible-play is a public page: most people reading it are not
  // signed in, and "we could not read your limits" would be a false alarm.
  const [signedOut, setSignedOut] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/play-limits')
      if (res.status === 401) {
        setSignedOut(true)
        setLoading(false)
        return
      }
      if (!res.ok) {
        // A blank panel must not read as "you have no limits".
        setUnreadable(true)
        setLoading(false)
        return
      }
      setSignedOut(false)
      const body = await res.json()
      setRows(Array.isArray(body?.limits) ? body.limits : [])
      if (body?.currency) setCurrency(body.currency as CurrencyCode)
      setUnreadable(false)
    } catch {
      setUnreadable(true)
    }
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading) return null

  if (signedOut) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-2)' }}>
        <a href="/auth/login?next=/legal/responsible-play" className="font-medium text-pip-text hover:underline">
          Sign in
        </a>{' '}
        to set a deposit or loss limit on your account.
      </p>
    )
  }

  if (unreadable) {
    return (
      <p role="alert" className="text-sm font-medium" style={{ color: 'var(--no-700)' }}>
        We could not read your limits just now. Reload the page — and if this keeps happening,
        contact us before you trade.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-5 not-prose">
      {(['deposit', 'loss'] as Kind[]).map((kind) => (
        <LimitCard
          key={kind}
          kind={kind}
          rows={rows.filter((r) => r.kind === kind)}
          currency={currency}
          onChanged={load}
        />
      ))}
    </div>
  )
}

function LimitCard({
  kind, rows, currency, onChanged,
}: {
  kind: Kind
  rows: LimitRow[]
  currency: CurrencyCode
  onChanged: () => void | Promise<void>
}) {
  const [period, setPeriod] = useState<Period>('day')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const row = rows.find((r) => r.period === period) ?? null
  const live = row?.amount ?? null
  const used = row?.used ?? 0
  const rowCurrency = row?.currency ?? currency
  const pending = row?.pending ?? null
  const typed = Number(value.replace(/[^\d.]/g, ''))
  const willWait = live != null && (value === '' ? false : typed > live)

  const post = async (payload: Record<string, unknown>, ok: (body: unknown) => string) => {
    setBusy(true); setError(''); setNote('')
    try {
      const res = await fetch('/api/account/play-limits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? 'That did not go through. Please try again.')
      } else {
        setNote(ok(body))
        setValue('')
        await onChanged()
      }
    } catch {
      setError('Network error. Check your connection and try again.')
    }
    setBusy(false)
  }

  const save = () => {
    if (!Number.isFinite(typed) || typed <= 0) {
      setError('Enter an amount above zero.')
      return
    }
    void post(
      { action: 'set', kind, period, amount: typed },
      (b) => {
        const change = (b as { change?: { in_force_now?: boolean } } | null)?.change
        return change?.in_force_now
          ? 'Saved. It is in force now.'
          : 'Asked for. A higher limit takes 24 hours, then needs confirming — your current limit stays until then.'
      },
    )
  }

  const copy = KIND_COPY[kind]
  const pct = live && live > 0 ? Math.min(100, Math.round((used / live) * 100)) : 0

  return (
    <section
      className="rounded-[var(--r-md)] px-4 py-4"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--hairline)' }}
    >
      <h3 className="text-[17px] font-semibold" style={{ color: 'var(--text)' }}>{copy.title}</h3>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-2)' }}>{copy.what}</p>

      {/* Which window. Rolling, so it is "any 24 hours" — not "today", which
          resets at midnight, exactly when a long session is at its worst. */}
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`${copy.title} period`}>
        {PERIOD_CHOICE.map((p) => {
          const on = p.key === period
          const set = rows.find((r) => r.period === p.key)?.amount != null
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => { setPeriod(p.key); setError(''); setNote('') }}
              aria-pressed={on}
              className="min-h-11 rounded-[var(--r-sm)] border px-3 text-sm font-medium"
              style={{
                borderColor: on ? 'var(--pip-500)' : 'var(--hairline-strong)',
                background: on ? 'var(--pip-100)' : 'transparent',
                color: 'var(--text)',
              }}
            >
              {p.label}
              {set && <span aria-hidden className="ml-1.5" style={{ color: 'var(--pip-text)' }}>•</span>}
              {set && <span className="sr-only"> (set)</span>}
            </button>
          )
        })}
      </div>

      {/* What is in force, and what is left of it. */}
      {live != null ? (
        <div className="mt-4">
          {/* "KSh 2,000 per 24 hours. KSh 2,000 left in the last 24 hours."
              was the first wording: it said the same number twice and read
              like a bug. What is left is the useful half once anything has
              been used, and the limit itself is the useful half before. */}
          <p className="text-sm" style={{ color: 'var(--text)' }}>
            {used > 0 ? (
              <>
                <strong>{money(Math.max(0, live - used), rowCurrency)}</strong> left of your{' '}
                {money(live, rowCurrency)} limit, in the {PERIOD_LABEL[period]}.
              </>
            ) : (
              <>
                <strong>{money(live, rowCurrency)}</strong> per {PERIOD_LABEL[period].replace('last ', '')}.{' '}
                <span style={{ color: 'var(--text-2)' }}>None of it used yet.</span>
              </>
            )}
          </p>
          {/* An empty bar is a horizontal rule pretending to be data. */}
          {used > 0 && (
            <div
              className="mt-2 h-2 w-full overflow-hidden rounded-full"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${copy.title} used`}
              style={{ background: 'var(--hairline)' }}
            >
              <div className="h-full" style={{ width: `${pct}%`, background: 'var(--pip-500)' }} />
            </div>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm" style={{ color: 'var(--text-2)' }}>No limit set for this period.</p>
      )}

      {/* A change still waiting out its 24 hours. */}
      {pending && (
        <div className="mt-4 rounded-[var(--r-sm)] px-3 py-3" style={{ background: 'var(--surface)', border: '1px solid var(--hairline-strong)' }}>
          <p className="text-sm" style={{ color: 'var(--text)' }}>
            {pending.amount == null
              ? 'Removing this limit is waiting.'
              : `A change to ${money(pending.amount, rowCurrency)} is waiting.`}{' '}
            <span style={{ color: 'var(--text-2)' }}>
              {pending.confirmable
                ? 'You can confirm it now.'
                : `You can confirm it ${waitLeft(pending.effective_at)}.`}
            </span>
          </p>
          <div className="mt-3 grid max-w-sm grid-cols-2 gap-3">
            <button
              type="button"
              className="btn btn-secondary btn-lg w-full"
              disabled={busy}
              onClick={() => void post({ action: 'cancel', id: pending.id }, () => 'Dropped. Your current limit stays.')}
            >
              Drop it
            </button>
            {/* Primary only once it can actually be pressed. A solid primary
                button nobody can use for 23 hours reads as a broken page. */}
            <button
              type="button"
              className={`btn btn-lg w-full ${pending.confirmable ? 'btn-primary' : 'btn-secondary'}`}
              disabled={busy || !pending.confirmable}
              onClick={() => void post({ action: 'confirm', id: pending.id }, () => 'Confirmed. It is in force now.')}
            >
              Confirm
            </button>
          </div>
        </div>
      )}

      {/* Setting one. Free text, in the account's currency. */}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[12rem]">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>
            {live == null ? 'Set a limit' : 'Change it to'} ({rowCurrency})
          </span>
          <input
            className="input w-full"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder={live == null ? 'e.g. 2000' : String(live)}
            value={value}
            onChange={(e) => { setValue(e.target.value); setError(''); setNote('') }}
          />
        </label>
        <button type="button" className="btn btn-primary btn-lg" onClick={save} disabled={busy || value === ''}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Say which way this change goes BEFORE it is made. */}
      {value !== '' && Number.isFinite(typed) && typed > 0 && (
        <p className="mt-2 text-sm" style={{ color: 'var(--text-2)' }}>
          {willWait
            ? 'This is higher than your current limit, so it takes 24 hours and then needs confirming.'
            : 'This takes effect as soon as you save it.'}
        </p>
      )}

      {/* The outcome belongs next to the control that caused it, not below
          the rest of the card. */}
      {note && <p role="status" className="mt-3 text-sm font-medium" style={{ color: 'var(--text)' }}>{note}</p>}
      {error && <p role="alert" className="mt-3 text-sm font-medium" style={{ color: 'var(--no-700)' }}>{error}</p>}

      {live != null && (
        <div>
          <button
            type="button"
            className="mt-3 min-h-11 text-sm font-medium underline"
            style={{ color: 'var(--text-2)' }}
            disabled={busy}
            onClick={() => void post(
              { action: 'set', kind, period, amount: null },
              () => 'Asked for. Removing a limit takes 24 hours, then needs confirming.',
            )}
          >
            Remove this limit
          </button>
        </div>
      )}
    </section>
  )
}
