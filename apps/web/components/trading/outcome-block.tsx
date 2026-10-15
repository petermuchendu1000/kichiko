// components/trading/outcome-block.tsx — what this trade costs and what it
// returns, both ways round.
//
// Ruling D5 of docs/research/ui-2026-09/40-ELEMENT-MATRIX.md, marked BINDING
// (L.N. 112 Reg. 45(1) and 23(1); Gambling Control Act 2025 s.72(6)).
//
// The ticket used to show "Total" and "To win" — the stake and the upside, and
// nothing else. A reader could see what they stood to gain without ever being
// shown what they stood to lose, which is the asymmetry the regulation is
// written against. Polymarket does the same ("To win $0.00"); Kalshi shows a
// "Max payout". Neither states the downside, so this is INVENT rather than
// ADOPT.
//
// Three decisions worth keeping:
//
//   • The loss line is typeset exactly like the win line — same size, same
//     weight, same colour. Dimming it would re-create the asymmetry in
//     styling after removing it from the content ([32] rule 2 makes the same
//     point about Confirm and Cancel).
//   • Money uses --text, not the yes/no tints. The tinted figures measured
//     4.56:1 and 5.14:1 against this project's 7:1 floor for money (A3); the
//     plain text colour clears it in both themes. Colour is carried by the
//     label, where it is decoration rather than data.
//   • 20px figures, the floor this project set for money ([32] rule 8).
// @/lib/currency, NOT @/lib/utils. Both export formatCurrency; the one in
// utils formats KES through Intl's en-KE currency style, which renders "Ksh",
// so this block printed "Ksh 200" directly beneath chips reading "KSh 200".
import { formatCurrency } from '@/lib/currency'
import type { CurrencyCode } from '@/types'

export function OutcomeBlock({
  payLocal,
  winLocal,
  sideLabel,
  currency,
  className = '',
}: {
  /** What leaves the wallet, in the display currency. */
  payLocal: number
  /** What comes back if this side wins, in the display currency. */
  winLocal: number
  /** The outcome being bought ("Yes", "No", or a candidate's name). */
  sideLabel: string
  currency: CurrencyCode
  className?: string
}) {
  const row = 'flex items-baseline justify-between gap-3'
  const label = 'text-sm text-text-secondary'
  const money = 'text-[20px] font-semibold tabular-nums text-text-primary'

  return (
    <dl className={`space-y-2 ${className}`} aria-label="What this trade costs and returns">
      <div className={row}>
        <dt className={label}>You pay</dt>
        <dd className={money}>{formatCurrency(payLocal, currency)}</dd>
      </div>
      <div className={row}>
        <dt className={label}>
          If <span className="font-semibold text-text-primary">{sideLabel}</span> wins, you get
        </dt>
        <dd className={money}>{formatCurrency(winLocal, currency)}</dd>
      </div>
      <div className={`${row} border-t border-hairline pt-2`}>
        <dt className={label}>If not, you lose</dt>
        <dd className={money}>{formatCurrency(payLocal, currency)}</dd>
      </div>
    </dl>
  )
}
