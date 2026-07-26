// lib/clob.ts — CLOB (Central Limit Order Book) shared types + pure helpers.
//
// Single source of truth for the order-book domain used by both the API layer
// (app/api/orders, app/api/markets/[id]/book) and the UI (candidate drawer).
// Everything here is framework-free and unit-tested (lib/__tests__/clob.test.ts)
// so the matching-adjacent math (cumulative depth, tick clamping, ¢/% format)
// can't silently drift from PM's ground truth
// (docs/design/PM-CLOB-DRAWER-MEASURED-2026-07.md).
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Price ticks. PM uses a 0.1¢ tick in [0.1¢, 99.9¢]; we store price_cents as
// numeric(4,1). YES(p) + NO(100-p) = 100¢ = $1 (complementary tokens).
// ---------------------------------------------------------------------------
export const CLOB_TICK = 0.1
export const CLOB_MIN_CENTS = 0.1
export const CLOB_MAX_CENTS = 99.9

/** Snap a cents price to the 0.1¢ grid and clamp to the tradable band. */
export function clampPriceCents(cents: number): number {
  if (!Number.isFinite(cents)) return CLOB_MIN_CENTS
  const snapped = Math.round(cents * 10) / 10
  return Math.min(CLOB_MAX_CENTS, Math.max(CLOB_MIN_CENTS, snapped))
}

/** Complementary price: the other side of a $1 set. 20¢ YES ⇒ 80¢ NO. */
export function complementCents(cents: number): number {
  return Math.round((100 - cents) * 10) / 10
}

// ---------------------------------------------------------------------------
// Formatting — PM shows every book price as "19.8%" with a muted "(19.8¢)".
// Probability % and price ¢ are numerically identical on a $1 contract.
// ---------------------------------------------------------------------------
export function formatCents(cents: number): string {
  // Price and probability are identical on a $1 contract, so we display % only.
  const n = Math.round(cents * 10) / 10
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`
}

export function formatPercent(cents: number): string {
  const n = Math.round(cents * 10) / 10
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`
}

/** Price label as a probability percentage (e.g. { percent: "19.8%" }). */
export function dualPriceLabel(cents: number): { percent: string } {
  return { percent: formatPercent(cents) }
}

// ---------------------------------------------------------------------------
// Book model. clob_get_book returns raw levels; the UI needs cumulative TOTAL
// (PM accumulates from the inside price outward) and a depth-bar width ratio.
// ---------------------------------------------------------------------------
export interface RawBookLevel {
  price: number // cents
  size: number // shares
}
export interface BookLevel extends RawBookLevel {
  totalShares: number // cumulative shares from inside-out
  totalUsd: number // cumulative notional (Σ price×size) — PM's TOTAL column
  depthPct: number // 0..1 for the background depth bar
}
export interface RawClobBook {
  market_id: string
  market_option_id: string | null
  outcome_side: 'yes' | 'no'
  bids: RawBookLevel[]
  asks: RawBookLevel[]
  last: number | null
  best_bid: number | null
  best_ask: number | null
  spread: number | null
}
export interface ClobBook extends Omit<RawClobBook, 'bids' | 'asks'> {
  bids: BookLevel[]
  asks: BookLevel[]
}

/**
 * Accumulate one side of the book from the inside price outward, mirroring PM's
 * TOTAL column (cumulative notional) and computing each level's depth-bar ratio
 * against the deepest cumulative notional on that side.
 *
 * @param levels ordered best→worst (bids desc, asks asc — as clob_get_book emits)
 */
export function withCumulativeTotals(levels: RawBookLevel[]): BookLevel[] {
  let cumShares = 0
  let cumUsd = 0
  const rows = levels.map((l) => {
    cumShares += l.size
    cumUsd += (l.price / 100) * l.size
    return { ...l, totalShares: cumShares, totalUsd: cumUsd, depthPct: 0 }
  })
  const maxUsd = rows.reduce((m, r) => Math.max(m, r.totalUsd), 0)
  if (maxUsd > 0) for (const r of rows) r.depthPct = r.totalUsd / maxUsd
  return rows
}

/** Shape a raw RPC book into the UI model (cumulative totals both sides). */
export function shapeBook(raw: RawClobBook): ClobBook {
  return {
    ...raw,
    bids: withCumulativeTotals(raw.bids ?? []),
    asks: withCumulativeTotals(raw.asks ?? []),
  }
}

// ---------------------------------------------------------------------------
// Request validation. CLOB orders are share-denominated (limit) or may be
// dollar-denominated for market buys (the API converts to size via best ask).
// ---------------------------------------------------------------------------
export const CURRENCIES = ['KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'BIF', 'USD'] as const

export const clobOrderSchema = z
  .object({
    engine: z.literal('clob'),
    market_id: z.string().uuid(),
    market_option_id: z.string().uuid(), // phase 1b: per-candidate book required
    outcome_side: z.enum(['yes', 'no']),
    action: z.enum(['buy', 'sell']).default('buy'),
    order_type: z.enum(['market', 'limit']),
    price_cents: z.number().min(CLOB_MIN_CENTS).max(CLOB_MAX_CENTS).optional(),
    size: z.number().positive().optional(), // shares
    amount_local: z.number().positive().optional(), // $ for market buys
    currency: z.enum(CURRENCIES),
    client_order_id: z.string().max(64).optional(),
    expires_at: z.string().datetime().optional(),
  })
  .refine((d) => d.order_type !== 'limit' || d.price_cents != null, {
    message: 'price_cents is required for limit orders',
    path: ['price_cents'],
  })
  .refine((d) => d.order_type !== 'limit' || d.size != null, {
    message: 'size (shares) is required for limit orders',
    path: ['size'],
  })
  .refine((d) => d.order_type !== 'market' || d.size != null || d.amount_local != null, {
    message: 'market orders need size or amount_local',
    path: ['size'],
  })

export type ClobOrderInput = z.infer<typeof clobOrderSchema>

// ---------------------------------------------------------------------------
// SQLSTATE → HTTP mapping for clob_place_order / clob_cancel_order. Single
// source of truth so the route stays declarative (mirrors BET_ERRORS).
// ---------------------------------------------------------------------------
export const CLOB_ERRORS: Record<string, { status: number; error: string }> = {
  P0001: { status: 404, error: 'Market not found or not active' },
  P0002: { status: 409, error: 'Market is closed for betting' },
  P0003: { status: 400, error: 'Unsupported currency' },
  P0005: { status: 400, error: 'Wallet not found for this currency' },
  P0006: { status: 402, error: 'Insufficient balance' },
  P0007: { status: 400, error: 'Selected option was not found for this market' },
  // P0100 retained for back-compat; the two-sided engine (migration 033) now
  // accepts sells, so it is no longer raised in practice.
  P0100: { status: 409, error: 'Sell orders are not yet available on this market' },
  P0113: { status: 409, error: 'Not enough shares to sell' },
  P0101: { status: 400, error: 'A candidate (market_option_id) is required' },
  P0102: { status: 400, error: 'Order size must be greater than zero' },
  P0103: { status: 409, error: 'This market is not an order-book market' },
  P0104: { status: 400, error: 'A limit price is required for limit orders' },
  P0110: { status: 404, error: 'Order not found' },
  P0111: { status: 403, error: 'You can only cancel your own orders' },
  P0112: { status: 409, error: 'Order is no longer cancellable' },
  // Authorization guard (migration 042): an end-user session may only act as
  // itself. Should never surface via the service_role API path, but mapped for
  // defense in depth.
  P0121: { status: 403, error: 'Not authorized to act on behalf of another user' },
}

/**
 * Map a CLOB RPC error to an HTTP status + friendly message.
 *
 * Postgres `RAISE ... USING ERRCODE='P00xx'` puts the code in the SQLSTATE,
 * which supabase-js/PostgREST expose as `error.code` — NOT inside
 * `error.message` (the message is the human string like "Insufficient
 * balance..."). So we MUST match on the code. We accept the whole error object
 * (preferred) and match `error.code` first; a raw string is still accepted and
 * scanned for a code as a fallback (keeps older callers/tests working).
 */
export function clobErrorFor(
  err: string | { code?: string | null; message?: string | null } | null | undefined,
): { status: number; error: string } | null {
  if (err == null) return null
  if (typeof err === 'string') {
    const code = Object.keys(CLOB_ERRORS).find((c) => err.includes(c))
    return code ? CLOB_ERRORS[code] : null
  }
  // Primary path: exact SQLSTATE match on the error code.
  if (err.code && CLOB_ERRORS[err.code]) return CLOB_ERRORS[err.code]
  // Defensive fallback: some layers embed the code in the message text.
  if (err.message) {
    const code = Object.keys(CLOB_ERRORS).find((c) => err.message!.includes(c))
    if (code) return CLOB_ERRORS[code]
  }
  return null
}

// ---------------------------------------------------------------------------
// Ticket helpers — pure math + payload construction shared by the order ticket
// (pm-ticket) so the on-screen estimate and the submitted order can never drift
// from each other, and both stay unit-tested (lib/__tests__/clob.test.ts).
// ---------------------------------------------------------------------------

/** Shares (max 6 dp, floored) a budget buys at a price. 0 if price invalid. */
export function estimateClobBuyShares(amountUsd: number, bestAskCents: number | null): number {
  if (!bestAskCents || bestAskCents <= 0 || amountUsd <= 0) return 0
  return Math.floor((amountUsd / (bestAskCents / 100)) * 1e6) / 1e6
}

/** Proceeds ($) from selling `size` shares at `priceCents`. 0 if inputs invalid. */
export function estimateClobSellProceedsUsd(size: number, priceCents: number | null): number {
  if (!priceCents || priceCents <= 0 || size <= 0) return 0
  return size * (priceCents / 100)
}

/** Exitable shares in a position: total minus what's escrowed by resting sells. */
export function clobAvailableShares(shares: number, reservedShares: number): number {
  return Math.max(0, (shares || 0) - (reservedShares || 0))
}

export interface ClobTicketPayloadInput {
  marketId: string
  marketOptionId: string
  outcomeSide: 'yes' | 'no'
  action: 'buy' | 'sell'
  orderType: 'market' | 'limit'
  currency: (typeof CURRENCIES)[number]
  /** Buy: local $ amount (market/amount-denominated). */
  amountLocal?: number
  /** Sell: shares to exit (share-denominated). */
  size?: number
  /** Limit price in cents (limit orders only). */
  priceCents?: number
}

/**
 * Build the exact `/api/orders` body for a CLOB order. Buys are market/amount-
 * denominated (the API converts $ → shares via the best ask). Sells are share-
 * denominated and may be market or limit. Never emits a price on a market order;
 * always clamps a limit price to the tradable 0.1¢ grid. Mirrors clobOrderSchema.
 */
export function buildClobOrderPayload(i: ClobTicketPayloadInput): Record<string, unknown> {
  const base = {
    engine: 'clob' as const,
    market_id: i.marketId,
    market_option_id: i.marketOptionId,
    outcome_side: i.outcomeSide,
    action: i.action,
    currency: i.currency,
  }
  if (i.action === 'buy') {
    // Buys are amount-denominated at market (converted to shares server-side via
    // the best ask). A LIMIT buy is share-denominated with a price and rests on
    // the book when it can't cross — the path that lets a user act on a fresh
    // market with no resting asks (friction #19).
    if (i.orderType === 'limit') {
      return { ...base, order_type: 'limit', size: i.size, price_cents: clampPriceCents(i.priceCents ?? 0) }
    }
    return { ...base, order_type: 'market', amount_local: i.amountLocal }
  }
  // Sell — share-denominated; limit adds a clamped price, market does not.
  return {
    ...base,
    order_type: i.orderType,
    size: i.size,
    ...(i.orderType === 'limit' ? { price_cents: clampPriceCents(i.priceCents ?? 0) } : {}),
  }
}
