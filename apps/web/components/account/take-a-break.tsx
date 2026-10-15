'use client'

// components/account/take-a-break.tsx — stopping, in two taps.
//
// Ruling I3, and L.N. 112 Reg. 84(2)(d) with 67(3): self-exclusion must be
// immediate and no harder to reach than the things that take money. What this
// replaces is a sentence saying "Contact us via the Help page and we'll set it
// up" — an email, a wait, and a human.
//
// Two taps: choose a length, then confirm. The confirm step is not friction
// for its own sake; a break cannot be undone, so it is the one place that has
// to be deliberate. Both buttons are the same size, as everywhere else a
// decision is offered ([32] rule 2).
import { useEffect, useState } from 'react'

type Duration = '24h' | '7d' | '30d' | 'indefinite'

const CHOICES: { key: Duration; label: string; sub: string }[] = [
  { key: '24h', label: '24 hours', sub: 'A day away' },
  { key: '7d', label: '7 days', sub: 'A week' },
  { key: '30d', label: '30 days', sub: 'A month' },
  { key: 'indefinite', label: 'Indefinitely', sub: 'Self-exclude — this cannot be undone' },
]

interface ActiveBreak {
  kind: 'break' | 'self_exclusion'
  ends_at: string | null
}

function until(ends: string | null): string {
  if (!ends) return 'indefinitely'
  const d = new Date(ends)
  return `until ${d.toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })}`
}

export function TakeABreak() {
  const [active, setActive] = useState<ActiveBreak | null>(null)
  const [loading, setLoading] = useState(true)
  const [chosen, setChosen] = useState<Duration | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let on = true
    fetch('/api/account/play-break')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (on) { setActive(b?.break ?? null); setLoading(false) } })
      .catch(() => { if (on) setLoading(false) })
    return () => { on = false }
  }, [])

  const start = async () => {
    if (!chosen) return
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/account/play-break', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration: chosen }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error ?? 'Could not start the break. Please try again.')
        setBusy(false)
        return
      }
      setActive({ kind: body.kind, ends_at: body.ends_at })
      setChosen(null)
    } catch {
      setError('Network error. Check your connection and try again.')
    }
    setBusy(false)
  }

  if (loading) return null

  if (active) {
    return (
      <div role="status" className="rounded-[var(--r-md)] px-4 py-4"
        style={{ background: 'var(--surface-2)', border: '1px solid var(--hairline)' }}>
        <p className="font-semibold" style={{ color: 'var(--text)' }}>
          {active.kind === 'self_exclusion'
            ? 'You have self-excluded.'
            : `You are on a break ${until(active.ends_at)}.`}
        </p>
        {/* Say plainly what still works. Someone who has just stopped playing
            must not be left wondering whether their money is stuck. */}
        <p className="mt-1 text-sm" style={{ color: 'var(--text-2)' }}>
          You cannot open new positions. You can still sell what you hold and withdraw your money at any time.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {CHOICES.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => { setChosen(c.key); setError('') }}
            aria-pressed={chosen === c.key}
            className="min-h-11 rounded-[var(--r-sm)] border px-3 py-2 text-left transition-colors"
            style={{
              borderColor: chosen === c.key ? 'var(--pip-500)' : 'var(--hairline-strong)',
              background: chosen === c.key ? 'var(--pip-100)' : 'transparent',
            }}
          >
            <span className="block text-sm font-semibold" style={{ color: 'var(--text)' }}>{c.label}</span>
            <span className="block text-xs" style={{ color: 'var(--text-2)' }}>{c.sub}</span>
          </button>
        ))}
      </div>

      {chosen && (
        <div className="mt-4">
          <p className="mb-2 text-sm" style={{ color: 'var(--text-2)' }}>
            {chosen === 'indefinite'
              ? 'You will not be able to open new positions again on this account. This cannot be undone.'
              : 'You will not be able to open new positions until the break ends. It cannot be shortened.'}{' '}
            Selling and withdrawing stay open.
          </p>
          <div className="grid max-w-sm grid-cols-2 gap-3">
            <button type="button" className="btn btn-secondary btn-lg w-full"
              onClick={() => setChosen(null)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-lg w-full" onClick={start} disabled={busy}>
              {busy ? 'Starting…' : 'Confirm'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium" style={{ color: 'var(--no-700)' }}>{error}</p>
      )}
    </div>
  )
}
