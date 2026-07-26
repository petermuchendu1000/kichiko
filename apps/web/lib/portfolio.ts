// ============================================================
// Kichiko — Portfolio P&L (live mark-to-market)
// ------------------------------------------------------------
// WHY THIS EXISTS
//   `positions.current_value_usd` is written once by place_bet at trade time
//   and is NEVER re-marked as prices move, so it goes stale immediately. The
//   portfolio must instead value open positions at the *current* market price.
//
//   This module is the single, tested source of truth for that valuation. It
//   is intentionally made of pure functions (no I/O) so it can be unit-tested
//   and reused by both the /api/portfolio route and the portfolio page.
//
// VALUATION MODEL (binary market, $1 per winning share)
//   ACTIVE market:
//     currentValue   = shares · livePrice(side)        // mark-to-market
//     unrealizedPnl  = currentValue − invested
//     realizedPnl    = 0
//   RESOLVED market:
//     win  (side === resolved_outcome): payout = shares · $1
//     loss (side !== resolved_outcome): payout = 0
//     currentValue   = payout (settled, no longer price-sensitive)
//     realizedPnl    = payout − invested
//     unrealizedPnl  = 0
//   CANCELLED market:
//     invested is refunded → currentValue = invested, realizedPnl = 0.
// ============================================================

import type { MarketStatus, PositionSide } from '@/types'

/** Minimal market pricing/resolution shape needed to value a position. */
export interface MarketValuationInput {
  yes_price: number
  no_price: number
  status: MarketStatus
  resolved_outcome: PositionSide | null
}

/** Minimal position shape needed for valuation (matches `positions` columns). */
export interface PositionValuationInput {
  id?: string
  side: PositionSide
  shares: number
  total_invested_usd: number
  is_active?: boolean
}

export type PositionOutcome =
  | 'active'
  | 'resolved_win'
  | 'resolved_loss'
  | 'cancelled'

export interface PositionPnl {
  positionId: string | null
  side: PositionSide
  shares: number
  invested: number
  /** Price used to mark the position (live price while active, $1/$0 once resolved). */
  markPrice: number
  /** Current USD value of the position (mark-to-market while active, settled payout once resolved). */
  currentValue: number
  /** Gain/loss on an open position vs. current prices. Zero once settled. */
  unrealizedPnl: number
  /** Locked-in gain/loss once a market resolves (or 0 for cancelled refunds). */
  realizedPnl: number
  /** unrealizedPnl + realizedPnl — the single number to show as the position's P&L. */
  totalPnl: number
  /** totalPnl as a fraction of invested (0 when nothing was invested). */
  pnlPct: number
  outcome: PositionOutcome
  /** True once the market is resolved or cancelled (no longer price-sensitive). */
  isSettled: boolean
}

function num(x: unknown): number {
  const n = typeof x === 'number' ? x : Number(x)
  return Number.isFinite(n) ? n : 0
}

/**
 * Mark-to-market USD value of a position at the given live prices.
 * value = shares · price(side). Pure; used by previews and aggregation.
 */
export function positionValue(
  side: PositionSide,
  shares: number,
  yesPrice: number,
  noPrice: number,
): number {
  const price = side === 'yes' ? num(yesPrice) : num(noPrice)
  return num(shares) * price
}

/** Unrealized P&L for an open position: currentValue − invested. */
export function unrealizedPnl(currentValue: number, invested: number): number {
  return num(currentValue) - num(invested)
}

/**
 * Realized P&L for a settled position.
 *   resolved win  → shares·$1 − invested
 *   resolved loss → −invested
 *   cancelled     → 0 (invested is refunded)
 */
export function resolvedPnl(
  outcome: PositionOutcome,
  shares: number,
  invested: number,
): number {
  switch (outcome) {
    case 'resolved_win':
      return num(shares) - num(invested) // $1 per winning share
    case 'resolved_loss':
      return -num(invested)
    default:
      return 0 // active or cancelled
  }
}

/** Classify a position's settlement state from the market it belongs to. */
export function classifyOutcome(
  side: PositionSide,
  market: Pick<MarketValuationInput, 'status' | 'resolved_outcome'>,
): PositionOutcome {
  if (market.status === 'cancelled') return 'cancelled'
  if (market.status === 'resolved') {
    if (!market.resolved_outcome) return 'cancelled' // resolved w/o outcome ⇒ treat as refund
    return market.resolved_outcome === side ? 'resolved_win' : 'resolved_loss'
  }
  return 'active'
}

/**
 * Compute full live P&L for a single position against its market.
 * This is the function the portfolio page and API should use — never read
 * `current_value_usd` off the row directly (it is stale).
 */
export function computePositionPnl(
  position: PositionValuationInput,
  market: MarketValuationInput | null | undefined,
): PositionPnl {
  const side = position.side
  const shares = num(position.shares)
  const invested = num(position.total_invested_usd)

  // No market joined (deleted/inaccessible) → fall back to invested at cost.
  if (!market) {
    return {
      positionId: position.id ?? null,
      side,
      shares,
      invested,
      markPrice: invested && shares ? invested / shares : 0,
      currentValue: invested,
      unrealizedPnl: 0,
      realizedPnl: 0,
      totalPnl: 0,
      pnlPct: 0,
      outcome: 'active',
      isSettled: false,
    }
  }

  const outcome = classifyOutcome(side, market)
  const isSettled = outcome !== 'active'

  let currentValue: number
  let markPrice: number
  let unreal = 0
  let real = 0

  if (outcome === 'active') {
    markPrice = side === 'yes' ? num(market.yes_price) : num(market.no_price)
    currentValue = positionValue(side, shares, market.yes_price, market.no_price)
    unreal = unrealizedPnl(currentValue, invested)
  } else if (outcome === 'cancelled') {
    markPrice = invested && shares ? invested / shares : 0
    currentValue = invested // refunded
  } else {
    // resolved_win / resolved_loss
    markPrice = outcome === 'resolved_win' ? 1 : 0
    currentValue = outcome === 'resolved_win' ? shares : 0
    real = resolvedPnl(outcome, shares, invested)
  }

  const totalPnl = unreal + real
  const pnlPct = invested > 0 ? totalPnl / invested : 0

  return {
    positionId: position.id ?? null,
    side,
    shares,
    invested,
    markPrice,
    currentValue,
    unrealizedPnl: unreal,
    realizedPnl: real,
    totalPnl,
    pnlPct,
    outcome,
    isSettled,
  }
}

export interface PortfolioSummary {
  /** Invested cost across OPEN positions only. */
  totalInvested: number
  /** Live mark-to-market value across OPEN positions. */
  totalCurrentValue: number
  /** Unrealized P&L across OPEN positions. */
  totalUnrealizedPnl: number
  /** Realized P&L across SETTLED positions. */
  totalRealizedPnl: number
  /** totalUnrealizedPnl + totalRealizedPnl. */
  totalPnl: number
  /** totalUnrealizedPnl / totalInvested for open positions (0 when none). */
  unrealizedPnlPct: number
  openCount: number
  settledCount: number
}

export interface PositionWithMarket extends PositionValuationInput {
  market?: MarketValuationInput | null
}

/** Raw position row as read from the DB (side is NULL for option positions). */
export interface RawPositionForValuation {
  id: string
  side: PositionSide | null
  market_option_id?: string | null
  shares: number
  total_invested_usd: number
  is_active?: boolean
}

/** The single option row needed to value a multiple_choice position. */
export interface OptionForValuation {
  price: number
  is_winner: boolean | null
}

/**
 * Map a raw position into the binary valuation model.
 *
 * Multiple-choice (option) positions carry `market_option_id` and a NULL
 * `side`. We model them as a synthetic YES position whose `yes_price` is the
 * option's live probability and whose settlement is decided by the option's
 * `is_winner` flag — so the entire tested binary P&L path (mark-to-market,
 * win/loss classification, realized/unrealized split) is reused verbatim and
 * we never branch on resolution type below this layer.
 */
export function toValuationInput<M extends MarketValuationInput>(
  p: RawPositionForValuation,
  market: M | null | undefined,
  option?: OptionForValuation | null,
): PositionWithMarket {
  if (p.market_option_id && option && market) {
    const price = num(option.price)
    const resolvedOutcome: PositionSide | null =
      market.status === 'resolved' ? (option.is_winner ? 'yes' : 'no') : null
    return {
      id: p.id,
      side: 'yes',
      shares: p.shares,
      total_invested_usd: p.total_invested_usd,
      is_active: p.is_active,
      market: { ...market, yes_price: price, no_price: 1 - price, resolved_outcome: resolvedOutcome },
    }
  }
  return {
    id: p.id,
    side: (p.side ?? 'yes') as PositionSide,
    shares: p.shares,
    total_invested_usd: p.total_invested_usd,
    is_active: p.is_active,
    market: market ?? null,
  }
}

/**
 * Aggregate live P&L across a set of positions (each carrying its joined market).
 * Open and settled positions are summarized separately so the UI can show
 * "open exposure" without contaminating it with locked-in realized P&L.
 */
export function summarizePortfolio(
  positions: ReadonlyArray<PositionWithMarket>,
): { summary: PortfolioSummary; positions: PositionPnl[] } {
  const computed = positions.map((p) => computePositionPnl(p, p.market))

  let totalInvested = 0
  let totalCurrentValue = 0
  let totalUnrealizedPnl = 0
  let totalRealizedPnl = 0
  let openCount = 0
  let settledCount = 0

  for (const c of computed) {
    if (c.isSettled) {
      settledCount++
      totalRealizedPnl += c.realizedPnl
    } else {
      openCount++
      totalInvested += c.invested
      totalCurrentValue += c.currentValue
      totalUnrealizedPnl += c.unrealizedPnl
    }
  }

  return {
    summary: {
      totalInvested,
      totalCurrentValue,
      totalUnrealizedPnl,
      totalRealizedPnl,
      totalPnl: totalUnrealizedPnl + totalRealizedPnl,
      unrealizedPnlPct: totalInvested > 0 ? totalUnrealizedPnl / totalInvested : 0,
      openCount,
      settledCount,
    },
    positions: computed,
  }
}
