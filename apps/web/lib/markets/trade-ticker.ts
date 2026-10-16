// lib/markets/trade-ticker.ts
// ---------------------------------------------------------------------------
// Server helper for the on-chart trade ticker: the trades that have landed in
// the last few minutes, per market, newest first.
//
// WHAT THIS IS, AND THE ONE THING THAT DECIDES WHETHER IT SHIPS
// Polymarket and Kalshi both animate each new trade onto the price chart as a
// "+ $N" label in that outcome's colour. Measured on both, 2026-10-16; see
// 40-ELEMENT-MATRIX K7 and captures-2026-10-chart-hero/.
//
// Ruling K7 rejected it **for a Kenyan licensee**, on L.N. 114 and on three
// findings in [31] — Barber (attention lists precede negative returns),
// Chapkovski (gamification selects low-literacy users) and Barasa 2026 (a
// Kenyan RCT where social interaction raised betting 13%). The owner's call,
// 2026-10-16: the company is registered in the US and the product is global,
// so it ships; when a Kenyan subsidiary is registered it comes off there.
//
// That decision is why none of this is hard-wired. `flags.live_trade_ticker`
// (default ON, public) is the switch, and the chart renders perfectly well
// without the overlay, so flipping it changes nothing else.
//
// WHY A RECENCY WINDOW
// The same reason spotlight-activity has one. A ticker is a claim that the
// market is trading NOW; feeding it month-old rows on a loop tells a visitor
// the opposite of the truth with more confidence than silence would. Past the
// window this returns nothing and the chart renders bare.
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * How recent a trade must be to animate onto a chart.
 *
 * Longer than it looks like it should be, deliberately. A Kenyan prediction
 * market is not a US sportsbook on game day: these markets settle in months
 * and trade in bursts. Ninety minutes is long enough to carry a burst across a
 * page view and short enough that nothing on screen is ever stale in a way a
 * reader would notice.
 */
export const TICKER_WINDOW_MS = 90 * 60 * 1000

/** Hard cap per market, so one busy minute cannot bury a plot in labels. */
export const TICKER_MAX = 12

export interface TickerTrade {
  id: string
  /** Null on a binary market, where the side carries the colour instead. */
  optionId: string | null
  side: 'yes' | 'no' | null
  /** Stake in USD, the ledger's unit. The UI converts and formats. */
  amountUsd: number
  /** Implied probability at the time of the trade, 0–1. */
  price: number | null
  /** ISO timestamp. */
  at: string
}

interface Row {
  id: string
  market_id: string
  market_option_id: string | null
  side: string | null
  amount_usd: number | null
  price: number | null
  created_at: string | null
}

function toTrade(r: Row): TickerTrade | null {
  if (!r.created_at) return null
  const amount = r.amount_usd ?? 0
  // A zero-stake row is a ledger artefact, not a trade anyone made; rendering
  // "+ KSh 0" over a chart would be worse than rendering nothing.
  if (!(amount > 0)) return null
  return {
    id: r.id,
    optionId: r.market_option_id,
    side: r.side === 'yes' || r.side === 'no' ? r.side : null,
    amountUsd: amount,
    price: r.price,
    at: r.created_at,
  }
}

/** Trades inside the window for one market, newest first. */
export async function getTickerTrades(
  supabase: SupabaseClient<any, any, any>,
  marketId: string,
  opts: { since?: string; limit?: number } = {},
): Promise<TickerTrade[]> {
  const windowStart = new Date(Date.now() - TICKER_WINDOW_MS).toISOString()
  // `since` lets a poller ask only for what it has not seen, but it can never
  // widen the window: a client passing an old timestamp still gets at most the
  // last TICKER_WINDOW_MS, so the recency guarantee is the server's, not the
  // caller's.
  const from = opts.since && opts.since > windowStart ? opts.since : windowStart

  const { data, error } = await supabase
    .from('market_activity')
    .select('id, market_id, market_option_id, side, amount_usd, price, created_at')
    .eq('market_id', marketId)
    .in('action', ['buy', 'sell'])
    .gt('created_at', from)
    .order('created_at', { ascending: false })
    .limit(Math.min(opts.limit ?? TICKER_MAX, TICKER_MAX))

  if (error || !data) return []
  return (data as Row[]).map(toTrade).filter((t): t is TickerTrade => t !== null)
}

/**
 * The same thing for the hero's handful of markets, in one round trip.
 * Best-effort: any failure yields an empty map and the hero renders without a
 * ticker, exactly as it does when the flag is off.
 */
export async function getTickerTradesForMarkets(
  supabase: SupabaseClient<any, any, any>,
  marketIds: string[],
): Promise<Record<string, TickerTrade[]>> {
  const out: Record<string, TickerTrade[]> = {}
  if (marketIds.length === 0) return out

  const windowStart = new Date(Date.now() - TICKER_WINDOW_MS).toISOString()
  const { data, error } = await supabase
    .from('market_activity')
    .select('id, market_id, market_option_id, side, amount_usd, price, created_at')
    .in('market_id', marketIds)
    .in('action', ['buy', 'sell'])
    .gt('created_at', windowStart)
    .order('created_at', { ascending: false })
    .limit(marketIds.length * TICKER_MAX)

  if (error || !data) return out
  for (const r of data as Row[]) {
    const t = toTrade(r)
    if (!t) continue
    const list = out[r.market_id] ?? (out[r.market_id] = [])
    if (list.length < TICKER_MAX) list.push(t)
  }
  return out
}
