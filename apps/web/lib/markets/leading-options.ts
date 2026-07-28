// lib/markets/leading-options.ts
// Server helper: for a set of multiple_choice markets, fetch their options in a
// single batched query and reduce to each market's front-runner + option count,
// so card surfaces can show the leading outcome instead of a binary YES/NO bar.
// market_options is public-read (RLS), so the caller's session client is fine.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface LeadingOption {
  label: string
  price: number
}

export interface LeadingOptionsResult {
  /** marketId → highest-priced option. */
  leadByMarket: Map<string, LeadingOption>
  /** marketId → number of options. */
  countByMarket: Map<string, number>
}

/**
 * Batch-load the leading option (and option count) for the given market ids.
 * Pass ONLY multiple_choice market ids. Returns empty maps when ids is empty.
 */
export async function getLeadingOptions(
  // Loosely typed to accept the generated Database-typed client without friction.
  supabase: SupabaseClient<any, any, any>,
  marketIds: string[],
): Promise<LeadingOptionsResult> {
  const leadByMarket = new Map<string, LeadingOption>()
  const countByMarket = new Map<string, number>()
  if (marketIds.length === 0) return { leadByMarket, countByMarket }

  const { data } = await supabase
    .from('market_options')
    .select('market_id, label, price, yes_price')
    .in('market_id', marketIds)

  for (const o of (data as { market_id: string; label: string; price: number | null; yes_price: number | null }[]) ?? []) {
    countByMarket.set(o.market_id, (countByMarket.get(o.market_id) ?? 0) + 1)
    // Canonical outcome value: for independent lines the candidate probability is
    // its Yes price; fall back to the shared-simplex `price`. This MUST match the
    // ordering used by getCardOptions/getOptionSeries so the "related markets"
    // rail never names a different front-runner than the card/chart legend.
    const price = o.yes_price ?? o.price ?? 0
    const cur = leadByMarket.get(o.market_id)
    if (!cur || price > cur.price) leadByMarket.set(o.market_id, { label: o.label, price })
  }
  return { leadByMarket, countByMarket }
}
