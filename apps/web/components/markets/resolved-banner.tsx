// components/markets/resolved-banner.tsx — how a settled market announces it.
//
// Ruling C6: ADOPT Polymarket's sticky outcome, which replaces the buy bar
// with the result rather than leaving a stale price on screen; INVENT the two
// things neither incumbent shows — WHEN it resolved and WHAT decided it
// (L.N. 112 Reg. 45(6)/(8): an independent mechanism, and records of it).
//
// Before this, a settled market said "Resolved: YES" in a badge the size of a
// category chip, beside the volume. The single most important fact about a
// finished market — whether the person's money came back — was styled like
// metadata.
//
// Kalshi's version is worth avoiding too: its side panel still read "To be
// determined" next to a full-time score, so the page disagreed with itself.
import { IconCheck, IconExternalLink } from '@/components/ui/icons'
import { resolutionSourceName } from '@/lib/markets/source-name'
import { safeHttpUrl } from '@/lib/security/sanitize'

/** "12 January 2027" — the resolution date, spelled out, in the market's terms. */
export function resolvedOnLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function ResolvedBanner({
  outcomeLabel,
  resolvedAt,
  resolutionSource,
  className = '',
}: {
  /** The winning outcome as a reader would name it: "Yes", "No", a candidate. */
  outcomeLabel: string
  resolvedAt?: string | null
  resolutionSource?: string | null
  className?: string
}) {
  const on = resolvedOnLabel(resolvedAt)
  const href = safeHttpUrl(resolutionSource)
  const sourceName = resolutionSourceName(resolutionSource)

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--r-md)] px-4 py-3 ${className}`}
      style={{ background: 'var(--surface-2)', border: '1px solid var(--hairline)' }}
    >
      <span
        aria-hidden
        className="grid h-6 w-6 flex-none place-items-center rounded-full"
        style={{ background: 'var(--yes)', color: '#fff' }}
      >
        <IconCheck size={14} />
      </span>

      {/* The outcome carries --text, not a tint: this is the page's conclusion,
          and the yes/no tints are tuned for small labels on their own fills. */}
      <p className="text-[17px] font-semibold" style={{ color: 'var(--text)' }}>
        Outcome: {outcomeLabel}
      </p>

      {on && (
        <span className="text-sm" style={{ color: 'var(--text-2)' }}>
          Resolved {on}
        </span>
      )}

      {/* The evidence. A settled market that cannot say what decided it is the
          gap C3 closed on open markets; it matters most once money has moved. */}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-pip-text hover:underline"
        >
          <IconExternalLink size={13} />
          Decided by {sourceName ?? 'the listed source'}
        </a>
      ) : sourceName ? (
        <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-2)' }}>
          <IconExternalLink size={13} />
          Decided by {sourceName}
        </span>
      ) : null}
    </div>
  )
}
