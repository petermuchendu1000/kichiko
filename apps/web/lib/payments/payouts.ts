// lib/payments/payouts.ts — send queued payouts, and settle unsettled ones by
// asking the provider (migration 083; audit 6.6 and the payout half of 6.10).
//
// Every send goes through a claim (claim_withdrawal_dispatch /
// claim_withdrawals_for_dispatch): an atomic state change queued ->
// dispatching that exactly one caller wins, so the request route and the
// worker can never both pay one withdrawal. The outcome is reported with
// record_withdrawal_dispatch: accepted -> sent, unknown -> unknown (NEVER
// re-sent), rejected -> refunded in the same transaction.
//
// The status sweep asks the provider about sent/unknown payouts with backoff
// and settles them through the same complete/fail RPCs as the webhooks. Only
// an authoritative provider answer settles: a failed or unavailable query
// leaves the payout as it is. M-Pesa has no synchronous payout status query
// here (its Transaction Status API answers by callback), so M-Pesa payouts are
// settled by the B2C result callback, which matches a lost-reply payout by our
// withdrawal id; the sweep records that they are waiting.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CurrencyCode, PaymentProvider } from '@/types'
import { processWithdrawal, type WithdrawResult } from '@/lib/payments'
import { completeWithdrawal, failWithdrawal } from '@/lib/payments/withdraw'
import { getMoMoTransferStatus } from '@/lib/payments/mtn-momo'
import { airtelDisbursementStatus } from '@/lib/payments/airtel-money'

export interface ClaimedPayout {
  id: string
  provider: PaymentProvider
  net_amount: number | string
  currency: CurrencyCode
  phone_number: string
  dispatch_attempts: number
}

export interface DispatchReport {
  id: string
  outcome: WithdrawResult['outcome']
  reference?: string
  message?: string
  recorded: boolean
}

type Rpc = Pick<SupabaseClient, 'rpc'>

/** Claim one withdrawal for sending. null: not queued (already claimed, under review, settled, legacy). */
export async function claimPayout(admin: Rpc, withdrawalId: string): Promise<ClaimedPayout | null> {
  const { data, error } = await admin.rpc('claim_withdrawal_dispatch' as never, { p_withdrawal_id: withdrawalId } as never)
  if (error) throw new Error(`claim_withdrawal_dispatch failed: ${error.message}`)
  return (data as ClaimedPayout | null) ?? null
}

/**
 * Send a claimed payout and report the outcome. Never throws for a provider
 * problem. If reporting fails, the row stays 'dispatching' and the sweep turns
 * it into 'unknown' after 10 minutes: it is never sent again.
 */
export async function dispatchPayout(admin: Rpc, p: ClaimedPayout): Promise<DispatchReport> {
  let result: WithdrawResult
  try {
    result = await processWithdrawal(p.provider, {
      amount: Number(p.net_amount),
      currency: p.currency,
      phone: p.phone_number,
      reference: p.id,
    })
  } catch (e) {
    result = { outcome: 'unknown', success: false, message: e instanceof Error ? e.message : 'send failed' }
  }
  const { data, error } = await admin.rpc('record_withdrawal_dispatch' as never, {
    p_withdrawal_id: p.id,
    p_outcome: result.outcome,
    p_reference: result.reference ?? null,
    p_message: result.message ?? null,
    p_raw: result.raw === undefined ? null : (result.raw as object),
  } as never)
  if (error) console.error('record_withdrawal_dispatch failed (the sweep will treat it as unknown):', p.id, error.message)
  return {
    id: p.id,
    outcome: result.outcome,
    reference: result.reference,
    message: result.message,
    recorded: !error && Boolean((data as { recorded?: boolean } | null)?.recorded),
  }
}

/** Worker: claim and send up to `limit` queued payouts (approved, retried, or not yet sent). */
export async function runPayoutDispatch(admin: Rpc, limit = 20): Promise<DispatchReport[]> {
  const { data, error } = await admin.rpc('claim_withdrawals_for_dispatch' as never, { p_limit: limit } as never)
  if (error) throw new Error(`claim_withdrawals_for_dispatch failed: ${error.message}`)
  const out: DispatchReport[] = []
  for (const p of (data as ClaimedPayout[] | null) ?? []) out.push(await dispatchPayout(admin, p))
  return out
}

export interface DueCheck {
  id: string
  provider: PaymentProvider
  provider_reference: string | null
  currency: CurrencyCode
  payout_state: 'sent' | 'unknown'
  check_count: number
}

export type CheckVerdict = 'completed' | 'failed' | 'pending' | 'no_status_api' | 'query_failed'

/** Ask the provider. Pure mapping of provider answers to a verdict; network via the provider libs. */
export async function queryPayoutStatus(c: DueCheck): Promise<{ verdict: CheckVerdict; receipt?: string; reason?: string; raw?: unknown }> {
  try {
    switch (c.provider) {
      case 'mtn_momo': {
        if (!c.provider_reference) return { verdict: 'query_failed', reason: 'no MTN reference' }
        const s = await getMoMoTransferStatus(c.provider_reference, c.currency)
        if (s.status === 'SUCCESSFUL') return { verdict: 'completed', receipt: s.financialTransactionId, raw: s }
        if (s.status === 'FAILED') return { verdict: 'failed', reason: s.reason || 'MTN MoMo disbursement failed', raw: s }
        return { verdict: 'pending', raw: s }
      }
      case 'airtel_money': {
        // Airtel transaction id is our withdrawal id
        const s = await airtelDisbursementStatus(c.provider_reference || c.id, c.currency)
        if (s.status === 'TS') return { verdict: 'completed', receipt: s.airtelMoneyId, raw: s }
        if (s.status === 'TF') return { verdict: 'failed', reason: s.message || 'Airtel Money disbursement failed', raw: s }
        return { verdict: 'pending', raw: s }
      }
      default:
        return { verdict: 'no_status_api' }
    }
  } catch (e) {
    return { verdict: 'query_failed', reason: e instanceof Error ? e.message : 'status query failed' }
  }
}

/** Sweep: claim due sent/unknown payouts (and stale sends), ask the provider, settle authoritative answers. */
export async function runPayoutStatusSweep(admin: Rpc, limit = 50): Promise<Record<CheckVerdict, number>> {
  const { data, error } = await admin.rpc('claim_withdrawals_for_status_check' as never, { p_limit: limit } as never)
  if (error) throw new Error(`claim_withdrawals_for_status_check failed: ${error.message}`)
  const counts: Record<CheckVerdict, number> = { completed: 0, failed: 0, pending: 0, no_status_api: 0, query_failed: 0 }
  for (const c of (data as DueCheck[] | null) ?? []) {
    const r = await queryPayoutStatus(c)
    counts[r.verdict]++
    try {
      if (r.verdict === 'completed') {
        await completeWithdrawal(admin as SupabaseClient, {
          withdrawalId: c.id,
          providerReference: c.provider_reference,
          providerReceipt: r.receipt ?? null,
          rawResponse: { status_check: r.raw ?? null },
        })
      } else if (r.verdict === 'failed') {
        await failWithdrawal(admin as SupabaseClient, c.id, r.reason || 'Disbursement failed', { status_check: r.raw ?? null })
      }
      await admin.rpc('note_withdrawal_status_check' as never, {
        p_withdrawal_id: c.id,
        p_result: { verdict: r.verdict, reason: r.reason ?? null, check: c.check_count },
      } as never)
    } catch (e) {
      console.error('payout status settle failed:', c.id, e instanceof Error ? e.message : e)
    }
  }
  return counts
}
