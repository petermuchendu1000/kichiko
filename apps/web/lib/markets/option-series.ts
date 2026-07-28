// lib/markets/option-series.ts
// ------------------------------------------------------------
// Server helper that batch-loads a PER-OPTION probability history for a set of
// markets, so a chart can draw ONE LINE PER OPTION (the Polymarket "event"
// chart) — the number of curves always matches the number of outcomes, which
// keeps the picture honest for multi-candidate races.
//
//   • multiple_choice → one line per market_option, using that option's
//                        recorded `price` points (its implied probability).
//   • binary / up-down → a single "Yes" line from the market-level yes_price
//                        points (market_option_id IS NULL rows).
//
// When a market has no recorded history yet we seed a flat 2-point line at the
// current probability so the chart still renders (flagged via `seeded`).
// price_history + market_options are public-read (RLS), so the caller's session
// client is fine. One query per table for the whole page.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface OptionLine {
  id: string
  label: string
  /** Current probability in [0,1]. */
  price: number
  /** Chronological probability points in [0,1] (oldest first). */
  points: number[]
  /** Entity image (candidate photo, team crest, logo) when stored. */
  imageUrl?: string | null
}

export interface MarketSeries {
  binary: boolean
  /** One line per outcome (ranked highest-probability first). */
  lines: OptionLine[]
  /** True when we had no recorded history and seeded flat lines. */
  seeded: boolean
  /** First → last delta of the leading line, in percentage points (signed). */
  changePct: number
  /** ISO timestamp of the earliest recorded point (null when seeded). */
  startAt: string | null
  /** ISO timestamp of the latest recorded point (null when seeded). */
  endAt: string | null
}

interface MarketRow {
  id: string
  resolution_type: string
  yes_price: number | null
}
interface OptionRow {
  id: string
  market_id: string
  label: string
  price: number | null
  yes_price: number | null
  display_order: number | null
  image_url: string | null
}
interface HistRow {
  market_id: string
  market_option_id: string | null
  yes_price: number | null
  price: number | null
  recorded_at: string
}

function downsample(points: number[], maxPoints: number): number[] {
  if (points.length <= maxPoints) return points
  const step = (points.length - 1) / (maxPoints - 1)
  return Array.from({ length: maxPoints }, (_, i) => points[Math.round(i * step)])
}

/**
 * Batch-load per-option probability series for the given market ids.
 * `maxPoints` caps how many recent points each line keeps (evenly sampled,
 * always keeping first + last). Returns an empty map when `marketIds` is empty.
 */
export async function getOptionSeries(
  supabase: SupabaseClient<any, any, any>,
  marketIds: string[],
  maxPoints = 60,
): Promise<Map<string, MarketSeries>> {
  const out = new Map<string, MarketSeries>()
  if (marketIds.length === 0) return out

  const [{ data: markets }, { data: options }, { data: hist }] = await Promise.all([
    supabase.from('markets').select('id, resolution_type, yes_price').in('id', marketIds),
    supabase
      .from('market_options')
      .select('id, market_id, label, price, yes_price, display_order, image_url')
      .in('market_id', marketIds),
    supabase
      .from('price_history')
      .select('market_id, market_option_id, yes_price, price, recorded_at')
      .in('market_id', marketIds)
      .order('recorded_at', { ascending: true }),
  ])

  const marketById = new Map<string, MarketRow>()
  for (const m of (markets as MarketRow[]) ?? []) marketById.set(m.id, m)

  // Group options by market.
  const optionsByMarket = new Map<string, OptionRow[]>()
  for (const o of (options as OptionRow[]) ?? []) {
    const list = optionsByMarket.get(o.market_id) ?? []
    list.push(o)
    optionsByMarket.set(o.market_id, list)
  }

  // Group history points: per-option (multi) and per-market (binary yes line).
  const optionPoints = new Map<string, number[]>() // key: option id
  const marketYesPoints = new Map<string, number[]>() // key: market id
  // Track the recorded time window per market so the chart can label its X axis
  // with real dates (rows arrive ordered ascending, so first=min, last=max).
  const timeRange = new Map<string, { start: string; end: string }>() // key: market id
  for (const r of (hist as HistRow[]) ?? []) {
    const range = timeRange.get(r.market_id)
    if (!range) timeRange.set(r.market_id, { start: r.recorded_at, end: r.recorded_at })
    else range.end = r.recorded_at
    if (r.market_option_id) {
      // Canonical column order MUST match the endpoint/legend value below
      // (yes_price ?? price) and getCardOptions, so the line body, its anchored
      // endpoint dot, and the "% chance" legend are one series by construction.
      const v = r.yes_price ?? r.price
      if (v == null) continue
      const list = optionPoints.get(r.market_option_id) ?? []
      list.push(Number(v))
      optionPoints.set(r.market_option_id, list)
    } else {
      const v = r.yes_price ?? r.price
      if (v == null) continue
      const list = marketYesPoints.get(r.market_id) ?? []
      list.push(Number(v))
      marketYesPoints.set(r.market_id, list)
    }
  }

  for (const id of marketIds) {
    const m = marketById.get(id)
    if (!m) continue
    const isMulti = m.resolution_type === 'multiple_choice'

    if (isMulti) {
      const opts = optionsByMarket.get(id) ?? []
      let seeded = false
      const lines: OptionLine[] = opts.map((o) => {
        const price = Number(o.yes_price ?? o.price ?? 0)
        let points = optionPoints.get(o.id) ?? []
        if (points.length < 2) {
          seeded = true
          points = [price, price]
        }
        points = downsample(points, maxPoints).slice()
        // Endpoint-anchoring GUARANTEE: the drawn line ALWAYS ends exactly at the
        // current legend/ranking price, so the chart can never visually
        // contradict the legend even when price_history lags a market_options
        // price update (the "44% legend, line ends at ~5%" class of bug). Legend,
        // ranking, and the plotted endpoint are one value by construction.
        // Locked by lib/__tests__/option-series.test.ts.
        if (points.length > 0) points[points.length - 1] = price
        return { id: o.id, label: o.label, price, points, imageUrl: o.image_url }
      })
      lines.sort((a, b) => b.price - a.price)
      const lead = lines[0]
      const changePct = lead ? Math.round((lead.points[lead.points.length - 1] - lead.points[0]) * 100) : 0
      const range = seeded ? null : timeRange.get(id) ?? null
      out.set(id, { binary: false, lines, seeded, changePct, startAt: range?.start ?? null, endAt: range?.end ?? null })
    } else {
      const price = Number(m.yes_price ?? 0)
      let points = marketYesPoints.get(id) ?? []
      let seeded = false
      if (points.length < 2) {
        seeded = true
        points = [price, price]
      }
      points = downsample(points, maxPoints).slice()
      // Same endpoint-anchoring guarantee as the multi branch: the Yes line ends
      // exactly at market.yes_price (the legend value).
      if (points.length > 0) points[points.length - 1] = price
      const changePct = Math.round((points[points.length - 1] - points[0]) * 100)
      const range = seeded ? null : timeRange.get(id) ?? null
      out.set(id, {
        binary: true,
        lines: [{ id, label: 'Yes', price, points }],
        seeded,
        changePct,
        startAt: range?.start ?? null,
        endAt: range?.end ?? null,
      })
    }
  }

  return out
}
