// ============================================================
// Withdrawal helper (server-only)
//
// The single chokepoint for the payout lifecycle. Pure, testable fee/limit
// logic lives here alongside thin wrappers over the atomic + idempotent
// withdrawal RPCs (migration 006):
//
//   requestWithdrawal()  → request_withdrawal  (reserve, atomic)
//   completeWithdrawal() → complete_withdrawal (release reserve, idempotent)
//   failWithdrawal()     → fail_withdrawal     (refund, idempotent)
//
// Do NOT hand-roll wallet/withdrawal/transaction updates in a route or a
// webhook — always funnel through here so atomicity + idempotency hold and the
// reserve → complete/fail invariant can never be violated.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { getUsdRate, localToUsd, type RatesMap } from '@/lib/currency'
import type { CurrencyCode, PaymentProvider } from '@/types'

// ------------------------------------------------------------
// Pure fee / limit logic (unit-tested, no I/O)
// ------------------------------------------------------------

/** Per-currency minimum withdrawal (local units). */
export const MIN_WITHDRAWALS: Record<CurrencyCode, number> = {
  KES: 100,
  UGX: 5000,
  TZS: 2000,
  RWF: 500,
  ZMW: 10,
  ETB: 100,
  BIF: 2000,
  USD: 5,
}

/**
 * Withdrawals above this USD value are held for manual admin review instead of
 * being disbursed immediately. (Formerly the KYC gate; KYC is deferred — see
 * the withdraw route hook — but the review threshold still applies.)
 */
export const REVIEW_THRESHOLD_USD = 500

/** Bank transfers are cheaper to settle than mobile-money B2C/disbursement. */
export function withdrawalFeeRate(provider: PaymentProvider): number {
  return provider === 'bank_transfer' ? 0.005 : 0.01
}

/**
 * Fee charged on a withdrawal, in the withdrawal currency. Rounded UP to a
 * whole unit (ceil) so we never under-charge and the net stays an integer for
 * mobile-money rails that reject fractional amounts.
 */
export function computeWithdrawalFee(amount: number, provider: PaymentProvider): number {
  if (!(amount > 0)) return 0
  return Math.ceil(amount * withdrawalFeeRate(provider))
}

/** Amount that actually leaves to the user after the fee. */
export function withdrawalNetAmount(amount: number, provider: PaymentProvider): number {
  return amount - computeWithdrawalFee(amount, provider)
}

/** Minimum withdrawal for a currency (falls back to a sane USD-ish floor). */
export function minWithdrawal(currency: CurrencyCode): number {
  return MIN_WITHDRAWALS[currency] ?? 5
}

/** True when the withdrawal is at/above the minimum for its currency. */
export function meetsMinWithdrawal(amount: number, currency: CurrencyCode): boolean {
  return amount >= minWithdrawal(currency)
}

/** KYC status that clears the withdrawal identity gate. */
export const KYC_VERIFIED_STATUS = 'verified'

/** Default USD value above which a verified identity is required to withdraw. */
export const KYC_REQUIRED_USD_DEFAULT = 100

/**
 * PURE KYC-gate decision (friction #16): should this withdrawal be blocked
 * pending identity verification? True only when the USD value exceeds the
 * threshold AND the account is not verified. The caller is responsible for
 * checking the `flags.withdraw_kyc_gate` feature flag first — when the flag is
 * off this decision is never consulted.
 */
export function requiresKycVerification(
  amountUsd: number,
  thresholdUsd: number,
  kycStatus: string | null | undefined,
): boolean {
  return amountUsd > thresholdUsd && kycStatus !== KYC_VERIFIED_STATUS
}

// ------------------------------------------------------------
// FX resolution (live rate wins, else currency-correct fallback)
// ------------------------------------------------------------

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

/** Resolve just the USD value of an amount (for the review-threshold gate). */
export async function withdrawalAmountUsd(
  admin: SupabaseClient,
  amount: number,
  currency: CurrencyCode,
): Promise<number> {
  const { amountUsd } = await resolveUsdRate(admin, currency)
  return amountUsd(amount)
}

// ------------------------------------------------------------
// RPC wrappers
// ------------------------------------------------------------

export interface RequestWithdrawalArgs {
  userId: string
  walletId: string
  amount: number
  currency: CurrencyCode
  provider: PaymentProvider
  phone: string
  feeAmount: number
  requiresReview: boolean
}

export interface RequestWithdrawalResult {
  success: boolean
  withdrawal_id: string
  transaction_id: string
  status: 'pending' | 'processing'
  amount: number
  fee_amount: number
  net_amount: number
  available_balance: number
  reserved_balance: number
}

/** Postgres SQLSTATE raised by request_withdrawal on insufficient funds. */
export const INSUFFICIENT_BALANCE_CODE = 'P0006'

/**
 * Atomically reserve balance and create the pending withdrawal + transaction.
 * Throws with `.code === 'P0006'` when the wallet lacks the funds so the caller
 * can map it to a clean 400.
 */
export async function requestWithdrawal(
  admin: SupabaseClient,
  args: RequestWithdrawalArgs,
): Promise<RequestWithdrawalResult> {
  const { exchangeRate, amountUsd } = await resolveUsdRate(admin, args.currency)

  const { data, error } = await admin.rpc('request_withdrawal', {
    p_user_id: args.userId,
    p_wallet_id: args.walletId,
    p_amount: args.amount,
    p_amount_usd: amountUsd(args.amount),
    p_exchange_rate: exchangeRate,
    p_fee_amount: args.feeAmount,
    p_provider: args.provider,
    p_phone: args.phone,
    p_requires_review: args.requiresReview,
  })

  if (error) {
    // Preserve the SQLSTATE so callers can branch on P0006 etc.
    const e = new Error(`request_withdrawal RPC failed: ${error.message}`) as Error & { code?: string }
    e.code = (error as { code?: string }).code
    throw e
  }
  return data as RequestWithdrawalResult
}

export interface CompleteWithdrawalArgs {
  withdrawalId: string
  providerReference?: string | null
  providerReceipt?: string | null
  rawResponse?: unknown
}

export interface CompleteWithdrawalResult {
  completed: boolean
  already_processed: boolean
  withdrawal_id?: string
  status?: string
}

/**
 * Finalize a confirmed payout — release the reserve, tally total_withdrawn,
 * notify the user. Idempotent: safe to call for every duplicate result webhook.
 */
export async function completeWithdrawal(
  admin: SupabaseClient,
  args: CompleteWithdrawalArgs,
): Promise<CompleteWithdrawalResult> {
  const { data, error } = await admin.rpc('complete_withdrawal', {
    p_withdrawal_id: args.withdrawalId,
    p_provider_reference: args.providerReference ?? null,
    p_provider_receipt: args.providerReceipt ?? null,
    p_raw_response: (args.rawResponse ?? {}) as never,
  })

  if (error) {
    throw new Error(`complete_withdrawal RPC failed: ${error.message}`)
  }
  return data as CompleteWithdrawalResult
}

export interface FailWithdrawalResult {
  failed: boolean
  already_processed: boolean
  withdrawal_id?: string
  refunded?: number
  note?: string
}

/**
 * Refund a failed/rejected payout — move the reserved funds back to available
 * and notify the user. Idempotent: never refunds a completed payout, never
 * double-refunds a failed one.
 */
export async function failWithdrawal(
  admin: SupabaseClient,
  withdrawalId: string,
  reason: string,
  rawResponse?: unknown,
): Promise<FailWithdrawalResult> {
  const { data, error } = await admin.rpc('fail_withdrawal', {
    p_withdrawal_id: withdrawalId,
    p_reason: reason,
    p_raw_response: (rawResponse ?? {}) as never,
  })

  if (error) {
    throw new Error(`fail_withdrawal RPC failed: ${error.message}`)
  }
  return data as FailWithdrawalResult
}
