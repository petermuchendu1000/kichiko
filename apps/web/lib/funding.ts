// ============================================================
// MarketPips — Funding math (pure, framework-free, unit-tested)
// ------------------------------------------------------------
// After a guest authenticates on a staged bet we "auto-advance" them to the
// action: place it if their wallet covers the stake, otherwise fund exactly the
// shortfall. This module owns that one decision so the ticket and any deposit
// prompt agree, and every branch is deterministic under vitest's `node` env.
// ============================================================

export interface FundingPlan {
  /** Wallet already covers the stake — proceed straight to placing. */
  funded: boolean
  /** Amount (in the same local currency) still needed; 0 when funded. */
  shortfall: number
}

/**
 * Decide funding for a stake against an available balance. Non-finite or
 * negative inputs are floored to 0 so a bad read can never mint a negative
 * shortfall or falsely report "funded". A zero/absent stake is trivially funded.
 */
export function planFunding(balanceLocal: number, amountLocal: number): FundingPlan {
  const balance = Number.isFinite(balanceLocal) && balanceLocal > 0 ? balanceLocal : 0
  const amount = Number.isFinite(amountLocal) && amountLocal > 0 ? amountLocal : 0
  if (amount === 0) return { funded: true, shortfall: 0 }
  if (balance >= amount) return { funded: true, shortfall: 0 }
  // Round the shortfall up to a whole unit — you can't deposit a fraction of a
  // shilling via mobile money, and topping up slightly over is always safe.
  return { funded: false, shortfall: Math.ceil(amount - balance) }
}
