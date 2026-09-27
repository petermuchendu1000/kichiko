// lib/markets/price-history.ts
// Server helper for the featured cards' probability sparkline. For a set of
// markets, batch-load their recorded Yes-price points (oldest → newest) so a
// card can draw a lightweight inline-SVG trend line of the market's implied
// probability over time. price_history is
// public-read (RLS), so the caller's session client is fine.
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchHistoryForMarkets } from './history'

export interface PriceSeries {
  /** Yes-price points in [0,1], chronological (oldest first). */
  points: number[]
  /** First → last delta in probability points (percentage points, signed). */
  changePct: number
}

interface Row {
  market_id: string
  yes_price: number | null
  price: number | null
  recorded_at: string
}

/**
 * Batch-load a chronological Yes-price series per market for sparklines.
 * `maxPoints` caps how many recent points each series keeps (evenly sampled).
 * Returns an empty map when `marketIds` is empty.
 */
export async function getPriceSeries(
  supabase: SupabaseClient<any, any, any>,
  marketIds: string[],
  maxPoints = 40,
): Promise<Map<string, PriceSeries>> {
  const out = new Map<string, PriceSeries>()
  if (marketIds.length === 0) return out

  // Per market, newest-first and paged past the 1,000-row cap (lib/markets/history.ts).
  const byMarket = await fetchHistoryForMarkets<Row>(supabase, marketIds, {
    select: 'market_id, yes_price, price, recorded_at',
  })

  const grouped = new Map<string, number[]>()
  for (const r of marketIds.flatMap((id) => byMarket.get(id) ?? [])) {
    const v = r.yes_price ?? r.price
    if (v == null) continue
    const list = grouped.get(r.market_id) ?? []
    list.push(Number(v))
    grouped.set(r.market_id, list)
  }

  for (const [id, all] of grouped) {
    if (all.length === 0) continue
    // Evenly downsample to at most `maxPoints`, always keeping first + last.
    let points = all
    if (all.length > maxPoints) {
      const step = (all.length - 1) / (maxPoints - 1)
      points = Array.from({ length: maxPoints }, (_, i) => all[Math.round(i * step)])
    }
    const changePct = Math.round((points[points.length - 1] - points[0]) * 100)
    out.set(id, { points, changePct })
  }

  return out
}
