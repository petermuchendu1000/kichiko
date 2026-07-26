// ============================================================
// Kichiko - Module 10: Leaderboard (pure logic)
// Metric/period validation, deterministic competition ranking with
// tie-breaks, medal mapping, and display formatters. Side-effect free
// and unit-testable (mirrors the SQL RANK() semantics in migration 007).
// ============================================================

import { usdToLocal } from './currency'

export const LEADERBOARD_METRICS = ['volume', 'winrate', 'pnl'] as const
export type LeaderboardMetric = (typeof LEADERBOARD_METRICS)[number]

export const LEADERBOARD_PERIODS = ['all', 'week', 'month'] as const
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number]

export const METRIC_META: Record<
  LeaderboardMetric,
  { label: string; short: string; field: keyof LeaderboardEntry }
> = {
  volume: { label: 'Volume', short: 'Vol', field: 'total_volume_usd' },
  winrate: { label: 'Win Rate', short: 'Win %', field: 'win_rate' },
  pnl: { label: 'Profit & Loss', short: 'P&L', field: 'profit_loss_usd' },
}

export const PERIOD_META: Record<LeaderboardPeriod, string> = {
  all: 'All-time',
  week: 'This Week',
  month: 'This Month',
}

export interface LeaderboardEntry {
  id: string
  display_name: string | null
  username: string | null
  avatar_url: string | null
  total_bets: number
  total_wins: number
  win_rate: number
  profit_loss_usd: number
  total_volume_usd: number
  rank?: number
}

export const DEFAULT_LEADERBOARD_LIMIT = 50
export const MAX_LEADERBOARD_LIMIT = 100

export function normalizeMetric(raw: string | null | undefined): LeaderboardMetric {
  return LEADERBOARD_METRICS.includes(raw as LeaderboardMetric)
    ? (raw as LeaderboardMetric)
    : 'volume'
}

export function normalizePeriod(raw: string | null | undefined): LeaderboardPeriod {
  return LEADERBOARD_PERIODS.includes(raw as LeaderboardPeriod)
    ? (raw as LeaderboardPeriod)
    : 'all'
}

export interface ParsedLeaderboardParams {
  metric: LeaderboardMetric
  period: LeaderboardPeriod
  limit: number
}

export function parseLeaderboardParams(sp: URLSearchParams): ParsedLeaderboardParams {
  const rawLimit = parseInt(sp.get('limit') || '', 10)
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LEADERBOARD_LIMIT)
    : DEFAULT_LEADERBOARD_LIMIT
  return {
    metric: normalizeMetric(sp.get('metric')),
    period: normalizePeriod(sp.get('period')),
    limit,
  }
}

function metricValue(e: LeaderboardEntry, metric: LeaderboardMetric): number {
  switch (metric) {
    case 'winrate':
      return e.win_rate ?? 0
    case 'pnl':
      return e.profit_loss_usd ?? 0
    default:
      return e.total_volume_usd ?? 0
  }
}

/**
 * Assign standard competition ranks (1,2,2,4...) for the given metric,
 * descending, with a deterministic id tie-break (matches the SQL
 * RANK() OVER (ORDER BY <metric> DESC, id)). Returns a new sorted array.
 */
export function computeRanks(
  entries: LeaderboardEntry[],
  metric: LeaderboardMetric
): LeaderboardEntry[] {
  const sorted = [...entries].sort((a, b) => {
    const diff = metricValue(b, metric) - metricValue(a, metric)
    if (diff !== 0) return diff
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  let rank = 0
  let seen = 0
  let prev: number | null = null
  return sorted.map((e) => {
    seen += 1
    const val = metricValue(e, metric)
    if (prev === null || val !== prev) {
      rank = seen // standard competition ranking (gaps after ties)
      prev = val
    }
    return { ...e, rank }
  })
}

export function medalFor(rank: number | undefined): string | null {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return null
}

// ---------- Formatters ----------

// Amounts are stored in USD; the pilot displays everything in Kenyan Shillings,
// so these render KES via the shared FX conversion (falls back to the pegged rate).
export function formatUsd(n: number | null | undefined): string {
  const kes = usdToLocal(n ?? 0, 'KES')
  return `KSh ${Math.round(kes).toLocaleString('en-KE')}`
}

export function formatSignedUsd(n: number | null | undefined): string {
  const v = n ?? 0
  const sign = v >= 0 ? '+' : '-'
  const kes = usdToLocal(Math.abs(v), 'KES')
  return `${sign}KSh ${Math.round(kes).toLocaleString('en-KE')}`
}

export function formatPct(rate: number | null | undefined): string {
  return `${Math.round((rate ?? 0) * 100)}%`
}

export function displayName(e: Pick<LeaderboardEntry, 'display_name' | 'username'>): string {
  return e.display_name || e.username || 'Anonymous'
}
