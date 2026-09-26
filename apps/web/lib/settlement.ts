// lib/settlement.ts — the single server-side answer to "which currency does
// this user's money move in?" (migration 079: the currency of their country).
//
// Money routes (orders, deposits, withdrawals) take the currency from here,
// never from the request. A client may still send `currency`, but only as an
// assertion: a mismatch is a 409 so a stale tab fails loudly instead of moving
// money in the wrong currency.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CurrencyCode } from '@/types'

export interface Settlement {
  country: string | null
  currency: CurrencyCode | null
  walletId: string | null
  locked: boolean
}

/** One round trip: user_settlement(user) (own row only; service role may read any). */
export async function getSettlement(sb: Pick<SupabaseClient, 'rpc'>, userId: string): Promise<Settlement | null> {
  const { data, error } = await sb.rpc('user_settlement' as never, { p_user: userId } as never)
  if (error) return null
  const row = (Array.isArray(data) ? data[0] : data) as
    | { country: string | null; currency: CurrencyCode | null; wallet_id: string | null; locked: boolean | null }
    | undefined
  if (!row) return null
  return { country: row.country, currency: row.currency, walletId: row.wallet_id, locked: !!row.locked }
}

export type CurrencyResolution =
  | { ok: true; currency: CurrencyCode; country: string }
  | { ok: false; status: number; error: string; code: 'country_required' | 'currency_mismatch' }

/** The currency a money operation must use, checked against what the client asserted (if anything). */
export function resolveMoneyCurrency(s: Settlement | null, requested?: string | null): CurrencyResolution {
  if (!s || !s.currency || !s.country) {
    return { ok: false, status: 409, code: 'country_required', error: 'Choose your country in Settings before moving money.' }
  }
  if (requested && requested !== s.currency) {
    return {
      ok: false, status: 409, code: 'currency_mismatch',
      error: `Your account settles in ${s.currency}; this request was in ${requested}. Refresh and try again.`,
    }
  }
  return { ok: true, currency: s.currency, country: s.country }
}
