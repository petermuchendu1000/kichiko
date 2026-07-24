// ============================================================
// MarketPips — Trading helpers (CLOB order routing + settlement)
// ------------------------------------------------------------
// Pure, unit-tested helpers shared by the order ticket and the resolve routes.
// The platform is CLOB-only: order sizing/fees are computed authoritatively by
// the clob_place_order RPC against the live order book, so there is no
// client-side AMM/LMSR preview here (the legacy previewBet* helpers + lib/lmsr
// were retired with the AMM engine).
// ============================================================

/** The trading-target fields of a POST /api/orders body. */
export type OrderTarget =
  | { side: 'yes' | 'no' }
  | { market_option_id: string }
  | { market_option_id: string; side: 'yes' | 'no' }

export interface OrderTargetArgs {
  /** Is this a multiple_choice market? */
  isMulti: boolean
  /** Independent per-candidate Yes/No mode (Phase C) — implies isMulti. */
  independent: boolean
  /** Selected candidate id (required for any multiple_choice order). */
  optionId?: string | null
  /** Chosen side (used by binary + independent; ignored by simplex). */
  side: 'yes' | 'no'
}

/**
 * Shape the trading-target fields of an order request, the single source of
 * truth the ticket UI uses so it always matches the /api/orders schema +
 * routing:
 *   • binary market                → { side }
 *   • simplex multiple_choice      → { market_option_id }
 *   • independent multiple_choice  → { market_option_id, side }  (Phase C)
 * Keeping this pure (and unit-tested) guarantees the client can never send an
 * independent option order WITHOUT a side (which the API rejects with 400).
 */
export function orderTarget(args: OrderTargetArgs): OrderTarget {
  const { isMulti, independent, optionId, side } = args
  if (!isMulti) return { side }
  if (!optionId) throw new Error('optionId is required for a multiple-choice order')
  return independent ? { market_option_id: optionId, side } : { market_option_id: optionId }
}

/**
 * Clamp a limit-price value (in cents) to the tradeable band. Prices settle to
 * $0..$1, so a limit is only meaningful in 1..99¢; 0 means "unset". Pure +
 * unit-tested so the ticket's − / + stepper and the /api/orders guard agree.
 */
export function clampLimitCents(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(99, Math.round(n)))
}

/** The opposite trading side — powers the ticket's ⇄ Yes/No swap affordance. */
export function oppositeSide(side: 'yes' | 'no'): 'yes' | 'no' {
  return side === 'yes' ? 'no' : 'yes'
}

/**
 * The multiple_choice SETTLEMENT RPC that matches a market's pricing engine.
 * Choosing the wrong one silently mis-settles funds:
 *   • simplex      → *_resolve_market_options        (pays winning-option holders)
 *   • independent  → *_resolve_market_options_binary (pays winning-Yes AND losing-No)
 * Pass `admin: true` for the capability-guarded admin-console wrappers. This is
 * the single source of truth both resolve routes use, so the binary path can
 * never be skipped for an independent market.
 */
export function optionsResolverRpc(
  pricingMode: string | null | undefined,
  admin = false,
): 'resolve_market_options' | 'resolve_market_options_binary'
  | 'admin_resolve_market_options' | 'admin_resolve_market_options_binary' {
  const independent = pricingMode === 'independent'
  if (admin) {
    return independent ? 'admin_resolve_market_options_binary' : 'admin_resolve_market_options'
  }
  return independent ? 'resolve_market_options_binary' : 'resolve_market_options'
}
