// lib/markets/leading-options.ts
// Server helper: for a set of multiple_choice markets, fetch their options in a
// single batched query and reduce to each market's front-runner + option count,
// so card surfaces can show the leading outcome instead of a binary YES/NO bar.
// market_options is public-read (RLS), so the caller's session client is fine.
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchCardOptionRows } from '@/lib/markets/card-options'

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

  // The front-runner and count per market, ranked in the database (migration
  // 097; audit 6.43) with the same ordering as the cards, so the rail never
  // names a different front-runner. Reading every option was cut at PostgREST's
  // max_rows (1,000).
  for (const o of await fetchCardOptionRows(supabase, marketIds, 1)) {
    countByMarket.set(o.market_id, o.option_count)
    leadByMarket.set(o.market_id, { label: o.label, price: Number(o.price) })
  }
  return { leadByMarket, countByMarket }
}
