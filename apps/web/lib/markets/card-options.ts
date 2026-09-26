// lib/markets/card-options.ts
// Server helper for the Polymarket-style market card. For a set of
// multiple_choice markets, batch-load each market's TOP OPTIONS (ranked by
// probability) so the grid card can render candidate rows —
//   "<label>   NN%   [Yes] [No]"
// — with a real option id on each Yes/No pill (used to deep-link the betting
// ticket pre-armed to that candidate + side). One query for the whole page.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface CardOption {
  id: string
  label: string
  /** Candidate probability in [0,1] (its Yes line for independent markets). */
  price: number
  imageUrl: string | null
}

export interface CardOptionsResult {
  /** marketId → up to `perMarket` options, highest probability first. */
  topByMarket: Map<string, CardOption[]>
  /** marketId → total option count (for the "+N more" affordance). */
  countByMarket: Map<string, number>
}

/**
 * Batch-load the top options (default 2) for the given multiple_choice market
 * ids. Pass ONLY multiple_choice ids. Returns empty maps when ids is empty.
 * market_options is public-read (RLS), so the caller's session client is fine.
 */
export async function getCardOptions(
  supabase: SupabaseClient<any, any, any>,
  marketIds: string[],
  perMarket = 2,
): Promise<CardOptionsResult> {
  const topByMarket = new Map<string, CardOption[]>()
  const countByMarket = new Map<string, number>()
  if (marketIds.length === 0) return { topByMarket, countByMarket }

  // Ranked in the database (migration 097; audit 6.43): reading every option
  // and ranking here was cut at PostgREST's max_rows (1,000) past which counts
  // and front-runners were wrong. The rows come back highest first per market.
  // Probability = the Yes price for independent lines, else the shared `price`.
  const rows = await fetchCardOptionRows(supabase, marketIds, perMarket)
  for (const o of rows) {
    countByMarket.set(o.market_id, o.option_count)
    const list = topByMarket.get(o.market_id) ?? []
    list.push({ id: o.id, label: o.label, price: Number(o.price), imageUrl: o.image_url })
    topByMarket.set(o.market_id, list)
  }
  return { topByMarket, countByMarket }
}

export interface CardOptionRow {
  market_id: string
  id: string
  label: string
  price: number
  image_url: string | null
  option_count: number
}

/** market_card_options (097): the top `perMarket` options per market, highest first, and each market's count. */
export async function fetchCardOptionRows(
  supabase: SupabaseClient<any, any, any>,
  marketIds: string[],
  perMarket: number,
): Promise<CardOptionRow[]> {
  const rows: CardOptionRow[] = []
  // the RPC takes at most 100 markets per call
  for (let i = 0; i < marketIds.length; i += 100) {
    const { data, error } = await supabase.rpc('market_card_options', {
      p_market_ids: marketIds.slice(i, i + 100),
      p_per_market: perMarket,
    })
    if (error) {
      // degrade as the old table read did: the cards render without option rows
      console.error('market_card_options failed:', error.message)
      break
    }
    rows.push(...((data as CardOptionRow[]) ?? []))
  }
  return rows
}
