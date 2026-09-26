// lib/payments/deposit-settle.ts — settle a deposit from the provider's
// authoritative status (deposit half of audit 6.10; migration 084).
//
// The webhooks settle a deposit when its callback arrives. A callback that is
// lost, rate-limited, WAF-challenged, or answered while the status query still
// said "processing" used to leave the deposit pending forever although the
// user had paid. The sweep (/api/cron/deposit-sweep) asks the provider about
// due deposits and settles through the same idempotent credit_deposit /
// fail_deposit, with the same idempotency keys as the webhooks, so a sweep and
// a late callback can never credit twice.
//
// Only an authoritative provider answer settles. A failed query, a
// still-processing answer, or (PesaPal) a status that does not match the
// deposit leaves it as it is.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CurrencyCode, PaymentProvider } from '@/types'
import { queryMpesaSTKStatus } from '@/lib/payments/mpesa'
import { getMoMoPaymentStatus } from '@/lib/payments/mtn-momo'
import { airtelTransactionStatus, airtelCountryForCurrency } from '@/lib/payments/airtel-money'
import { getPesaPalStatus } from '@/lib/payments/pesapal'
import { creditDeposit, failDeposit } from '@/lib/payments/credit'

export interface DueDeposit {
  id: string
  provider: PaymentProvider
  amount: number | string
  currency: CurrencyCode
  checkout_request_id: string | null
  mtn_reference_id: string | null
  airtel_reference: string | null
  pesapal_order_id: string | null
  check_count: number
}

export type DepositVerdict =
  | { kind: 'credit'; receipt: string | null; idempotencyKey: string; raw: unknown }
  | { kind: 'fail'; reason: string; raw: unknown }
  | { kind: 'pending'; raw?: unknown }
  | { kind: 'mismatch'; reason: string; raw?: unknown }
  | { kind: 'no_reference' }
  | { kind: 'query_failed'; reason: string }
  | { kind: 'unsupported' }

/**
 * M-Pesa STK query ResultCode. 0 paid; 4999 "still under processing" is not
 * an answer yet; any other code is the provider's terminal failure (1032
 * cancelled, 1037 no response from the handset, 1 insufficient funds, ...).
 */
export function classifyStkResult(code: unknown): 'paid' | 'pending' | 'failed' {
  const n = Number(code)
  if (!Number.isFinite(n)) return 'pending'
  if (n === 0) return 'paid'
  if (n === 4999) return 'pending'
  return 'failed'
}

/**
 * A PesaPal status applies to a deposit only if it is about THAT deposit:
 * merchant reference = deposit id, same amount, same currency when reported
 * (audit 6.3). Returns what does not match, or null.
 */
export function pesapalMismatch(
  live: { merchantReference?: string; amount?: number; currency?: string },
  deposit: { id: string; amount: number | string; currency: string },
): 'merchant_reference' | 'amount' | 'currency' | null {
  if (live.merchantReference !== deposit.id) return 'merchant_reference'
  if (typeof live.amount !== 'number' || Math.round(live.amount * 100) !== Math.round(Number(deposit.amount) * 100)) return 'amount'
  if (live.currency && live.currency.toUpperCase() !== String(deposit.currency).toUpperCase()) return 'currency'
  return null
}

export async function queryDepositStatus(d: DueDeposit): Promise<DepositVerdict> {
  try {
    switch (d.provider) {
      case 'mpesa': {
        if (!d.checkout_request_id) return { kind: 'no_reference' }
        const q = await queryMpesaSTKStatus(d.checkout_request_id)
        const c = classifyStkResult(q.ResultCode)
        if (c === 'paid') return { kind: 'credit', receipt: null, idempotencyKey: `mpesa_${d.checkout_request_id}`, raw: { query: q } }
        if (c === 'failed') return { kind: 'fail', reason: q.ResultDesc || 'M-Pesa payment failed', raw: { query: q } }
        return { kind: 'pending', raw: { query: q } }
      }
      case 'mtn_momo': {
        if (!d.mtn_reference_id) return { kind: 'no_reference' }
        const s = await getMoMoPaymentStatus(d.mtn_reference_id, d.currency)
        if (s.status === 'SUCCESSFUL') return { kind: 'credit', receipt: s.financialTransactionId ?? null, idempotencyKey: `mtn_${d.mtn_reference_id}`, raw: s }
        if (s.status === 'FAILED') return { kind: 'fail', reason: s.reason || 'MTN MoMo payment failed', raw: s }
        return { kind: 'pending', raw: s }
      }
      case 'airtel_money': {
        if (!d.airtel_reference) return { kind: 'no_reference' }
        const s = await airtelTransactionStatus(d.airtel_reference, airtelCountryForCurrency(d.currency) ?? 'KE')
        if (s.status === 'TS') {
          return { kind: 'credit', receipt: s.airtelMoneyId ?? d.airtel_reference, idempotencyKey: `airtel_${s.airtelMoneyId || d.airtel_reference}`, raw: s }
        }
        if (s.status === 'TF') return { kind: 'fail', reason: 'Airtel Money payment failed', raw: s }
        return { kind: 'pending', raw: s }
      }
      case 'pesapal': {
        if (!d.pesapal_order_id) return { kind: 'no_reference' }
        const live = await getPesaPalStatus(d.pesapal_order_id)
        const bad = pesapalMismatch(live, { id: d.id, amount: d.amount, currency: d.currency })
        if (bad) return { kind: 'mismatch', reason: bad, raw: live.raw }
        if (live.status === 'COMPLETED') {
          return { kind: 'credit', receipt: live.confirmationCode ?? d.pesapal_order_id, idempotencyKey: `pesapal_${d.id}`, raw: live.raw }
        }
        if (live.status === 'FAILED' || live.status === 'INVALID' || live.status === 'REVERSED') {
          return { kind: 'fail', reason: `PesaPal ${live.status}`, raw: live.raw }
        }
        return { kind: 'pending', raw: live.raw }
      }
      default:
        return { kind: 'unsupported' }
    }
  } catch (e) {
    return { kind: 'query_failed', reason: e instanceof Error ? e.message : 'status query failed' }
  }
}

type Admin = Pick<SupabaseClient, 'rpc'>

export async function applyDepositVerdict(admin: Admin, d: DueDeposit, v: DepositVerdict): Promise<void> {
  if (v.kind === 'credit') {
    await creditDeposit(admin as SupabaseClient, {
      depositId: d.id,
      amount: Number(d.amount),
      currency: d.currency,
      providerReceipt: v.receipt,
      rawCallback: { status_check: v.raw ?? null },
      idempotencyKey: v.idempotencyKey,
    })
  } else if (v.kind === 'fail') {
    await failDeposit(admin as SupabaseClient, d.id, v.reason, { status_check: v.raw ?? null })
  }
}

export type SweepCounts = Record<DepositVerdict['kind'], number> & { errors: number }

export async function runDepositStatusSweep(admin: Admin, limit = 50): Promise<SweepCounts> {
  const { data, error } = await admin.rpc('claim_deposits_for_status_check' as never, { p_limit: limit } as never)
  if (error) throw new Error(`claim_deposits_for_status_check failed: ${error.message}`)
  const counts: SweepCounts = { credit: 0, fail: 0, pending: 0, mismatch: 0, no_reference: 0, query_failed: 0, unsupported: 0, errors: 0 }
  for (const d of (data as DueDeposit[] | null) ?? []) {
    const v = await queryDepositStatus(d)
    counts[v.kind]++
    try {
      await applyDepositVerdict(admin, d, v)
      await admin.rpc('note_deposit_status_check' as never, {
        p_deposit_id: d.id,
        p_result: { verdict: v.kind, reason: 'reason' in v ? v.reason : null, check: d.check_count },
      } as never)
    } catch (e) {
      counts.errors++
      console.error('deposit sweep settle failed:', d.id, e instanceof Error ? e.message : e)
    }
  }
  return counts
}
