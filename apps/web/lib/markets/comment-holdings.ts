// lib/markets/comment-holdings.ts
// ---------------------------------------------------------------------------
// Which side a commenter is on, for the disclosure badge beside their name
// (matrix C10, migration 115).
//
// Polymarket wears the commenter's position — `76.7K Flávio Bolsonaro`. We
// wear the side and not the size, on purpose: their commenters are
// pseudonymous wallets, ours are named KYC'd Kenyans, and "Tabitha Chebet
// holds 5,889 shares of Gachagua" is personal financial data about an
// identified person. The part a reader needs in order to discount an argument
// is WHICH SIDE; the amount adds almost nothing to that and a great deal to
// the commenter's exposure. See migration 115 for the full reasoning.

/** A commenter's disclosed position in the market being discussed. */
export interface CommentHolding {
  /** The outcome they hold, e.g. "William Ruto". Null on a binary market. */
  optionLabel: string | null
  /** 'yes' = backing that outcome, 'no' = betting against it. */
  side: 'yes' | 'no'
}

export type CommentHoldingMap = Record<string, CommentHolding>

/** A row as `market_comment_holdings` returns it. */
export interface HoldingRow {
  user_id: string | null
  option_label: string | null
  side: string | null
}

export function toHoldingMap(rows: readonly HoldingRow[] | null | undefined): CommentHoldingMap {
  const out: CommentHoldingMap = {}
  for (const r of rows ?? []) {
    if (!r?.user_id) continue
    // Anything that is not exactly 'yes' or 'no' is dropped rather than
    // coerced: a badge that guesses the side is worse than no badge, because
    // it would read as a disclosure while asserting the opposite of the truth.
    if (r.side !== 'yes' && r.side !== 'no') continue
    out[r.user_id] = { optionLabel: r.option_label ?? null, side: r.side }
  }
  return out
}

/**
 * The badge's words.
 *
 * "Backs" / "Against" rather than "Yes" / "No": a reader skimming a comment
 * thread should not have to translate market notation into a stance. On a
 * binary market there is no outcome to name, so it degrades to the plain
 * "Holds Yes" / "Holds No" the ticket already uses.
 *
 * `label` is for the eye and `description` for a screen reader, which gets the
 * whole sentence because it cannot see the badge sitting beside a name.
 */
export function describeHolding(h: CommentHolding, authorName: string): {
  label: string
  description: string
  backing: boolean
} {
  const backing = h.side === 'yes'
  if (!h.optionLabel) {
    return {
      label: backing ? 'Holds Yes' : 'Holds No',
      description: `${authorName} holds a ${backing ? 'Yes' : 'No'} position in this market`,
      backing,
    }
  }
  return {
    label: `${backing ? 'Backs' : 'Against'} ${h.optionLabel}`,
    description: `${authorName} ${backing ? 'holds a position backing' : 'holds a position against'} ${h.optionLabel}`,
    backing,
  }
}
