// ============================================================
// Deposit credit helper (server-only)
//
// The single chokepoint every provider webhook (M-Pesa, MTN, Airtel, PesaPal)
// goes through to credit a confirmed deposit. It:
//   1. Resolves the USD exchange rate via the canonical FX module
//      (lib/currency) — live rate from exchange_rates wins, else the
//      currency-correct last-known-good fallback (never `|| 1`).
//   2. Calls the atomic + idempotent `credit_deposit` / `fail_deposit` RPCs
//      (migration 005). All money movement happens inside ONE DB transaction
//      with row locks, so concurrent callbacks can never double-credit.
//
// Do NOT credit wallets by hand-rolling deposit/wallet/transaction updates in
// a route — always funnel through here so atomicity + idempotency hold.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { getUsdRate, localToUsd, type RatesMap } from '@/lib/currency'
import type { CurrencyCode } from '@/types'

export interface CreditDepositArgs {
  /** deposits.id (uuid) */
  depositId: string
  /** Local-currency amount of the deposit (used only for the USD calc here;
   *  the RPC reads the authoritative amount from the deposit row itself). */
  amount: number
  currency: CurrencyCode
  /** Provider receipt / financial-transaction id, for reconciliation. */
  providerReceipt?: string | null
  /** Full raw provider payload, persisted on the deposit + transaction. */
  rawCallback?: unknown
  /**
   * Stable idempotency key. MUST be derived from a provider-unique value
   * (e.g. `mpesa_<receipt>`, `mtn_<referenceId>`) so retried callbacks collide
   * on transactions.idempotency_key and are rejected as already-processed.
   */
  idempotencyKey: string
}

export interface CreditDepositResult {
  credited: boolean
  already_processed: boolean
  deposit_id: string
  transaction_id?: string
  amount?: number
  currency?: string
  balance_before?: number
  balance_after?: number
  status?: string
  note?: string
}

/** Look up the live USD rate for a currency from the exchange_rates table. */
async function resolveUsdRate(
  admin: SupabaseClient,
  currency: CurrencyCode,
): Promise<{ exchangeRate: number; amountUsd: (amount: number) => number }> {
  const { data: rateRow } = await admin
    .from('exchange_rates')
    .select('rate')
    .eq('from_currency', currency)
    .eq('to_currency', 'USD')
    .maybeSingle()

  const liveRate = rateRow?.rate != null ? Number(rateRow.rate) : undefined
  const rateMap: RatesMap | undefined = liveRate
    ? ({ [currency]: liveRate } as RatesMap)
    : undefined

  const exchangeRate = getUsdRate(currency, rateMap)
  return {
    exchangeRate,
    amountUsd: (amount: number) => localToUsd(amount, currency, rateMap),
  }
}

/**
 * Credit a confirmed deposit to the user's wallet — atomic + idempotent.
 * Safe to call multiple times for the same deposit (second call is a no-op).
 */
export async function creditDeposit(
  admin: SupabaseClient,
  args: CreditDepositArgs,
): Promise<CreditDepositResult> {
  const { exchangeRate, amountUsd } = await resolveUsdRate(admin, args.currency)

  const { data, error } = await admin.rpc('credit_deposit', {
    p_deposit_id: args.depositId,
    p_amount_usd: amountUsd(args.amount),
    p_exchange_rate: exchangeRate,
    p_provider_receipt: args.providerReceipt ?? null,
    p_raw_callback: (args.rawCallback ?? {}) as never,
    p_idempotency_key: args.idempotencyKey,
  })

  if (error) {
    throw new Error(`credit_deposit RPC failed: ${error.message}`)
  }
  return data as CreditDepositResult
}

export interface FailDepositResult {
  failed: boolean
  already_processed?: boolean
  deposit_id?: string
}

/** Mark a non-completed deposit as failed — never clobbers a credited deposit. */
export async function failDeposit(
  admin: SupabaseClient,
  depositId: string,
  reason: string,
  rawCallback?: unknown,
): Promise<FailDepositResult> {
  const { data, error } = await admin.rpc('fail_deposit', {
    p_deposit_id: depositId,
    p_reason: reason,
    p_raw_callback: (rawCallback ?? {}) as never,
  })

  if (error) {
    throw new Error(`fail_deposit RPC failed: ${error.message}`)
  }
  return data as FailDepositResult
}

export interface ReverseDepositResult {
  reversed: boolean
  already_processed?: boolean
  deposit_id?: string
  debited?: number
  shortfall?: number
  account_suspended?: boolean
}

/**
 * A chargeback / provider reversal (audit 6.30, migration 086). A credited
 * deposit is taken back from the available balance; any shortfall suspends
 * the account. A deposit never credited is just failed. Idempotent.
 */
export async function reverseDeposit(
  admin: SupabaseClient,
  depositId: string,
  reason: string,
  raw?: unknown,
): Promise<ReverseDepositResult> {
  const { data, error } = await admin.rpc('reverse_deposit' as never, {
    p_deposit_id: depositId,
    p_reason: reason,
    p_raw: (raw ?? {}) as never,
  } as never)
  if (error) throw new Error(`reverse_deposit RPC failed: ${error.message}`)
  return data as ReverseDepositResult
}
