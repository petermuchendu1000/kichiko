// lib/creator/earnings.ts — Pure, DB-agnostic aggregation for the creator console.
//
// Creator rewards on Kichiko are accrued as a fraction of the trading volume on
// the markets a creator authored (markets.creator_reward_rate, a real fraction
// e.g. 0.0025 = 0.25%) and PAID OUT as ledger entries in `transactions` with
// type = 'creator_reward' (amount_usd, credited to the creator's wallet). This
// module never invents rates or amounts — every figure is derived from rows the
// caller reads from the DB (all *_usd values are true USD; the UI converts to
// KES via the canonical currency helpers with a live rates map).
//
// Two complementary earnings figures are exposed:
//   • accrued  — Σ(market.total_volume_usd × market.creator_reward_rate) across
//                the creator's markets. This is what the volume has earned.
//   • paid     — Σ(transactions.amount_usd) for completed creator_reward rows.
//                This is what has actually been settled to the wallet.
// Both are pure functions so they can be unit-tested without a database.

/** Market row shape this module depends on (subset of `markets`). */
export interface CreatorMarketRow {
  id: string
  status: string
  total_volume_usd: number | string | null
  creator_reward_rate: number | string | null
  unique_bettors: number | string | null
  created_at: string
}

/** Creator-reward ledger row shape (subset of `transactions`). */
export interface CreatorRewardTxnRow {
  amount_usd: number | string | null
  status: string
  created_at: string
  market_id: string | null
}

/** Coerce a Postgres NUMERIC (often string) or nullable number to a finite number. */
export function num(v: number | string | null | undefined): number {
  if (v == null || v === '') return 0
  const n = typeof v === 'string' ? Number(v) : v
  return Number.isFinite(n) ? n : 0
}

/** Reward (USD) accrued by a single market from its own volume × rate. */
export function marketAccruedRewardUsd(m: CreatorMarketRow): number {
  return num(m.total_volume_usd) * num(m.creator_reward_rate)
}

/** Total reward (USD) accrued across all the creator's markets (volume × rate). */
export function accruedRewardUsd(markets: readonly CreatorMarketRow[]): number {
  return (markets ?? []).reduce((sum, m) => sum + marketAccruedRewardUsd(m), 0)
}

/** Total reward (USD) actually PAID — completed creator_reward ledger rows only. */
export function paidRewardUsd(txns: readonly CreatorRewardTxnRow[]): number {
  return (txns ?? [])
    .filter((t) => t.status === 'completed')
    .reduce((sum, t) => sum + num(t.amount_usd), 0)
}

/** Total trading volume (USD) across the creator's markets. */
export function totalVolumeUsd(markets: readonly CreatorMarketRow[]): number {
  return (markets ?? []).reduce((sum, m) => sum + num(m.total_volume_usd), 0)
}

/** Count markets by status (draft / pending / active / closed / resolved / …). */
export function countByStatus(
  markets: readonly CreatorMarketRow[]
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const m of markets ?? []) {
    const s = m.status || 'unknown'
    out[s] = (out[s] ?? 0) + 1
  }
  return out
}

export interface MonthlyReward {
  /** ISO month key, e.g. "2026-07". */
  month: string
  usd: number
  count: number
}

/**
 * Group PAID creator-reward ledger rows into a monthly USD series, ascending by
 * month. Only completed rows are counted (pending/failed payouts are excluded).
 */
export function rewardByMonth(txns: readonly CreatorRewardTxnRow[]): MonthlyReward[] {
  const buckets = new Map<string, { usd: number; count: number }>()
  for (const t of txns ?? []) {
    if (t.status !== 'completed') continue
    const d = new Date(t.created_at)
    if (Number.isNaN(d.getTime())) continue
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const cur = buckets.get(month) ?? { usd: 0, count: 0 }
    cur.usd += num(t.amount_usd)
    cur.count += 1
    buckets.set(month, cur)
  }
  return [...buckets.entries()]
    .map(([month, v]) => ({ month, usd: v.usd, count: v.count }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

export interface CreatorOverview {
  totalMarkets: number
  activeMarkets: number
  pendingMarkets: number
  draftMarkets: number
  resolvedMarkets: number
  totalVolumeUsd: number
  accruedRewardUsd: number
  paidRewardUsd: number
  totalBettors: number
}

/** Roll up the overview KPIs from the creator's markets + reward ledger. */
export function summarizeCreatorOverview(
  markets: readonly CreatorMarketRow[],
  rewardTxns: readonly CreatorRewardTxnRow[]
): CreatorOverview {
  const byStatus = countByStatus(markets)
  const resolved = (byStatus.resolved ?? 0) + (byStatus.closed ?? 0)
  return {
    totalMarkets: (markets ?? []).length,
    activeMarkets: byStatus.active ?? 0,
    pendingMarkets: byStatus.pending ?? 0,
    draftMarkets: byStatus.draft ?? 0,
    resolvedMarkets: resolved,
    totalVolumeUsd: totalVolumeUsd(markets),
    accruedRewardUsd: accruedRewardUsd(markets),
    paidRewardUsd: paidRewardUsd(rewardTxns),
    totalBettors: (markets ?? []).reduce((s, m) => s + num(m.unique_bettors), 0),
  }
}
