// lib/markets/history.ts
// ------------------------------------------------------------
// Complete, newest-anchored price history for charts.
//
// Why this exists: PostgREST caps every response at 1,000 rows. The previous
// chart queries ordered oldest-first with no paging (or with .limit(200) /
// .limit(1000)), so a market with more history than the cap was drawn from its
// OLDEST rows: on 2026-09-27 the 2027-presidency market (1,908 rows, 24 Apr–13
// Aug) rendered 24–30 Apr, and endpoint anchoring then joined that April line
// straight to today's price, drawing a move that never happened. See
// docs/research/ui-2026-09/40-ELEMENT-MATRIX.md row A13.
//
// fetchMarketHistory pages newest-first until the history is exhausted (bounded
// by maxRows) and returns rows oldest-first. thinByRecency then keeps the payload
// small without distorting the time-range views the charts filter client-side.
import type { SupabaseClient } from '@supabase/supabase-js'

/** PostgREST's default max-rows. Pages are requested at this size. */
export const PAGE_SIZE = 1000

export type OptionScope = 'any' | 'market' | 'options'

export interface HistoryQuery {
  /** Columns to select; must include `recorded_at`. */
  select: string
  /** 'market' = market-level rows (market_option_id IS NULL); 'options' = per-option rows. */
  scope?: OptionScope
  /** Safety bound on rows read per market. */
  maxRows?: number
}

/**
 * All price_history rows for one market, oldest first. Reads newest-first in
 * PAGE_SIZE pages so that if maxRows is ever reached, what is dropped is the
 * oldest history, never the newest.
 */
export async function fetchMarketHistory<T extends { recorded_at: string }>(
  supabase: SupabaseClient<any, any, any>,
  marketId: string,
  { select, scope = 'any', maxRows = 20_000 }: HistoryQuery,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    let q = supabase.from('price_history').select(select).eq('market_id', marketId)
    if (scope === 'market') q = q.is('market_option_id', null)
    if (scope === 'options') q = q.not('market_option_id', 'is', null)
    const { data, error } = await q
      .order('recorded_at', { ascending: false })
      .range(from, Math.min(from + PAGE_SIZE, maxRows) - 1)
    if (error || !data) break
    rows.push(...(data as unknown as T[]))
    if (data.length < PAGE_SIZE) break
  }
  return rows.reverse()
}

/** fetchMarketHistory for several markets in parallel, keyed by market id. */
export async function fetchHistoryForMarkets<T extends { recorded_at: string }>(
  supabase: SupabaseClient<any, any, any>,
  marketIds: string[],
  query: HistoryQuery,
): Promise<Map<string, T[]>> {
  const entries = await Promise.all(
    marketIds.map(async (id) => [id, await fetchMarketHistory<T>(supabase, id, query)] as const),
  )
  return new Map(entries)
}

const DAY = 86_400_000

/** Per-tier point caps, measured back from the series' latest point. */
export const RECENCY_TIERS: Array<{ withinMs: number; max: number }> = [
  { withinMs: DAY, max: 120 },
  { withinMs: 7 * DAY, max: 80 },
  { withinMs: 30 * DAY, max: 60 },
  { withinMs: Number.POSITIVE_INFINITY, max: 80 },
]

function evenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items
  if (max <= 1) return [items[items.length - 1]]
  const step = (items.length - 1) / (max - 1)
  return Array.from({ length: max }, (_, i) => items[Math.round(i * step)])
}

/**
 * Thin a chronological series so each recency tier keeps at most its cap, evenly
 * sampled, always keeping the tier's first and last point. The latest point is
 * always kept, so the chart ends where the data ends.
 */
export function thinByRecency<T>(
  rows: T[],
  timeOf: (row: T) => string,
  tiers = RECENCY_TIERS,
): T[] {
  if (rows.length === 0) return rows
  const latest = new Date(timeOf(rows[rows.length - 1])).getTime()
  const buckets: T[][] = tiers.map(() => [])
  for (const r of rows) {
    const age = latest - new Date(timeOf(r)).getTime()
    const i = tiers.findIndex((t) => age < t.withinMs)
    buckets[i === -1 ? tiers.length - 1 : i].push(r)
  }
  // Tiers are youngest-first; output must be chronological (oldest tier first).
  const out: T[] = []
  for (let i = tiers.length - 1; i >= 0; i--) out.push(...evenly(buckets[i], tiers[i].max))
  return out
}
