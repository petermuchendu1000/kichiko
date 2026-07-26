// lib/polymarket-parity.ts — Polymarket-parity pricing & fee primitives.
//
// Derived from the empirical ground-truth research in docs/research/polymarket:
//   * Fee model  : fee = C · rate · p · (1 − p)   (taker-only, symmetric about p=0.5)
//                  verified 10/10 against Polymarket's published fee tables.
//   * Coherence  : binary  P(YES)+P(NO)=1 ; multi-outcome Σ P(i)=1  (no-arbitrage).
//   * Tick lattice: prices quantise to a per-market tick ∈ {0.001, 0.01} (65%/35% live).
//
// Framework-free & unit-tested (lib/__tests__/polymarket-parity.test.ts) so the
// money math cannot silently drift from PM's ground truth. Amounts are plain
// numbers here (probabilities/USD); persist money as numeric in the DB.

import type { MarketCategory } from '@/types'

// ---------------------------------------------------------------------------
// Fee model — fee = C · rate · p · (1 − p), taker-only.
// Rates are per Polymarket's published category schedule (docs/research/polymarket
// /00-PRIMITIVES-AND-PROTOCOL.md §4). Geopolitics/world-events are fee-free.
// ---------------------------------------------------------------------------
export const POLYMARKET_FEE_MIN_USD = 0.00001 // smallest chargeable fee; below → 0
export const POLYMARKET_FEE_DECIMALS = 5

/** Taker fee rate by Kichiko category (maps PM's schedule onto our enum). */
export const POLYMARKET_TAKER_FEE_RATE: Record<MarketCategory, number> = {
  crypto: 0.07,
  sports: 0.05,
  economics: 0.05,
  business: 0.04, // finance-like
  technology: 0.04,
  politics: 0.04,
  elections: 0.04,
  governance: 0.04,
  entertainment: 0.05, // culture
  weather: 0.05,
  health: 0.05,
  social: 0.05,
  other: 0.05,
}

/** Round a USD fee to PM's 5-dp precision, flooring dust below the min to 0. */
export function roundFeeUsd(fee: number): number {
  if (!Number.isFinite(fee) || fee <= 0) return 0
  const rounded = Math.round(fee * 1e5) / 1e5
  return rounded < POLYMARKET_FEE_MIN_USD ? 0 : rounded
}

/**
 * Taker fee in USD for `shares` contracts filled at price `p` (implied prob in
 * [0,1]) given a fee `rate`. Symmetric about p=0.5; peaks there.
 *   fee = shares · rate · p · (1 − p)
 */
export function takerFeeUsd(shares: number, p: number, rate: number): number {
  if (!Number.isFinite(shares) || !Number.isFinite(p) || !Number.isFinite(rate)) return 0
  if (shares <= 0 || rate <= 0) return 0
  const price = Math.min(1, Math.max(0, p))
  return roundFeeUsd(shares * rate * price * (1 - price))
}

/** Convenience: taker fee for a category. */
export function takerFeeForCategory(shares: number, p: number, category: MarketCategory): number {
  return takerFeeUsd(shares, p, POLYMARKET_TAKER_FEE_RATE[category] ?? 0.05)
}

// ---------------------------------------------------------------------------
// No-arbitrage coherence — YES+NO=1 (binary) and Σp=1 (multi-outcome).
// ---------------------------------------------------------------------------

/** Sum of implied probabilities. For a coherent market this is ≈ 1. */
export function impliedSum(prices: readonly number[]): number {
  return prices.reduce((s, p) => s + (Number.isFinite(p) ? p : 0), 0)
}

/**
 * True if the price vector is coherent (Σp within `tol` of 1). Default tol 0.01
 * matches the empirical 100% (Gamma) / 97.25% (live books) coherence we measured.
 */
export function isCoherent(prices: readonly number[], tol = 0.01): boolean {
  if (prices.length === 0) return false
  return Math.abs(impliedSum(prices) - 1) <= tol
}

/**
 * Normalise a price vector so Σp=1 (de-vig). Returns a new array. Non-finite or
 * negative inputs are treated as 0; an all-zero vector returns a uniform prior.
 */
export function normalizeToOne(prices: readonly number[]): number[] {
  const clean = prices.map((p) => (Number.isFinite(p) && p > 0 ? p : 0))
  const total = clean.reduce((s, p) => s + p, 0)
  if (total <= 0) return prices.map(() => 1 / Math.max(1, prices.length))
  return clean.map((p) => p / total)
}

// ---------------------------------------------------------------------------
// Tick lattice — generalised beyond the 0.1¢ CLOB tick to support PM's
// {0.001, 0.01} price ticks. Works in probability units (0..1).
// ---------------------------------------------------------------------------
export type PriceTick = 0.001 | 0.01

/** Snap an implied probability to `tick` and clamp to the tradable (tick,1−tick). */
export function quantizeToTick(p: number, tick: PriceTick): number {
  if (!Number.isFinite(p)) return tick
  const steps = Math.round(p / tick)
  const snapped = steps * tick
  const lo = tick
  const hi = 1 - tick
  const clamped = Math.min(hi, Math.max(lo, snapped))
  // avoid binary float dust (e.g. 0.30000000000000004)
  const decimals = tick === 0.001 ? 3 : 2
  return Number(clamped.toFixed(decimals))
}

/** True if `p` lies exactly on the tick lattice. */
export function isOnTick(p: number, tick: PriceTick): boolean {
  return Math.abs(p - quantizeToTick(p, tick)) < 1e-9
}
