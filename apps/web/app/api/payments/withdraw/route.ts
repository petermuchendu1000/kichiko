// app/api/payments/withdraw/route.ts — request a withdrawal (payout)
//
// Money movement is atomic + idempotent via the migration-006 RPCs, funnelled
// through lib/payments/withdraw.ts:
//   1. request_withdrawal reserves the balance (available → reserved) and
//      creates the pending withdrawal + transaction in ONE locked transaction.
//      A concurrent withdrawal can NEVER overdraw (wallet is FOR UPDATE'd).
//   2. Disbursement is ASYNC: we initiate it with the provider and leave the
//      withdrawal in 'processing'. The provider's result webhook later calls
//      complete_withdrawal (release reserve) or fail_withdrawal (refund).
//   3. If the provider rejects synchronously, we fail_withdrawal immediately so
//      the reserved funds are refunded — money is never stuck reserved.
//
// KYC gate: config-driven (friction #16). Enforced when the
// `flags.withdraw_kyc_gate` feature flag is ON: any withdrawal whose USD value
// exceeds `limits.kyc_required_usd` requires a verified identity, otherwise the
// route returns 403 { kyc_required: true } and the UI routes to /kyc. The flag
// ships OFF (dark launch) so behaviour is unchanged until the KYC review queue
// is staffed. Account-status and the USD review-threshold gates remain active.
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { processWithdrawal } from '@/lib/payments'
import { isFeatureEnabled } from '@/lib/flags'
import { getNumberSetting } from '@/lib/admin/settings'
import {
  computeWithdrawalFee,
  withdrawalNetAmount,
  meetsMinWithdrawal,
  minWithdrawal,
  withdrawalAmountUsd,
  requestWithdrawal,
  failWithdrawal,
  requiresKycVerification,
  REVIEW_THRESHOLD_USD,
  INSUFFICIENT_BALANCE_CODE,
} from '@/lib/payments/withdraw'
import type { CurrencyCode, PaymentProvider } from '@/types'

const WithdrawSchema = z.object({
  amount: z.number().positive(),
  currency: z.enum(['KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'BIF', 'USD']),
  phone_number: z.string().min(10).max(20),
  provider: z.enum(['mpesa', 'mtn_momo', 'airtel_money', 'pesapal', 'bank_transfer', 'internal']),
})

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const admin = await createAdminClient()

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json().catch(() => null)
    const parsed = WithdrawSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0].message }, { status: 400 })
    }

    const { amount, currency, phone_number, provider } = parsed.data
    const cur = currency as CurrencyCode
    const prov = provider as PaymentProvider

    // Account-status gate.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_status, kyc_status')
      .eq('id', user.id)
      .single()

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 400 })
    }
    if (profile.account_status !== 'active') {
      return NextResponse.json({ error: 'Account is suspended' }, { status: 403 })
    }

    // Minimum withdrawal (currency-specific).
    if (!meetsMinWithdrawal(amount, cur)) {
      return NextResponse.json(
        { error: `Minimum withdrawal is ${minWithdrawal(cur)} ${currency}` },
        { status: 400 },
      )
    }

    // USD value drives both the KYC gate and the review-threshold decision.
    const amountUSD = await withdrawalAmountUsd(admin, amount, cur)

    // -----------------------------------------------------------------
    // KYC GATE (config-driven — see file header). Only enforced when the
    // feature flag is ON. Large payouts (by USD value) need a verified
    // identity; otherwise we return a guided 403 that the UI turns into a
    // "verify to withdraw" → /kyc step rather than a bare rejection.
    // -----------------------------------------------------------------
    if (await isFeatureEnabled(supabase, 'flags.withdraw_kyc_gate')) {
      const kycThresholdUsd = await getNumberSetting(supabase, 'limits.kyc_required_usd')
      if (requiresKycVerification(amountUSD, kycThresholdUsd, profile.kyc_status)) {
        return NextResponse.json(
          {
            error: `Verify your identity to withdraw more than $${kycThresholdUsd}. It only takes a minute.`,
            kyc_required: true,
          },
          { status: 403 },
        )
      }
    }

    // Resolve the user's wallet for this currency.
    const { data: wallet } = await admin
      .from('wallets')
      .select('id')
      .eq('user_id', user.id)
      .eq('currency', currency)
      .single()

    if (!wallet) {
      return NextResponse.json({ error: 'Wallet not found' }, { status: 400 })
    }

    // Fee + review decision. Large payouts (by USD value) are held for admin
    // review instead of being disbursed immediately.
    const feeAmount = computeWithdrawalFee(amount, prov)
    const netAmount = withdrawalNetAmount(amount, prov)
    const requiresReview = amountUSD > REVIEW_THRESHOLD_USD

    // Atomic reserve + pending withdrawal/transaction creation.
    let reserved
    try {
      reserved = await requestWithdrawal(admin, {
        userId: user.id,
        walletId: wallet.id,
        amount,
        currency: cur,
        provider: prov,
        phone: phone_number,
        feeAmount,
        requiresReview,
      })
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === INSUFFICIENT_BALANCE_CODE) {
        return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })
      }
      if (code === 'P0011') {
        return NextResponse.json({ error: 'Wallet not found' }, { status: 400 })
      }
      if (code === 'P0012') {
        return NextResponse.json({ error: 'Wallet is inactive' }, { status: 403 })
      }
      console.error('request_withdrawal failed:', e)
      return NextResponse.json({ error: 'Failed to reserve balance' }, { status: 500 })
    }

    const withdrawalId = reserved.withdrawal_id

    // Held for review → do NOT disburse. Admin processes it later; the reserve
    // stays in place until complete/fail. Notify the user it's under review.
    if (requiresReview) {
      await admin.from('notifications').insert({
        user_id: user.id,
        type: 'withdrawal_completed',
        title: 'Withdrawal Under Review',
        body: `Your withdrawal of ${amount.toLocaleString()} ${currency} is under review. Funds will arrive within 24 hours.`,
        data: { withdrawal_id: withdrawalId },
      })

      return NextResponse.json({
        success: true,
        withdrawal_id: withdrawalId,
        status: 'under_review',
        message: 'Withdrawal under review. Funds will arrive within 24 hours.',
        fee: feeAmount,
        net_amount: netAmount,
      })
    }

    // Initiate the disbursement. The net amount (after fee) is what leaves.
    try {
      const result = await processWithdrawal(prov, {
        amount: netAmount,
        currency: cur,
        phone: phone_number,
        reference: withdrawalId,
      })

      if (!result.success) {
        // Provider rejected up-front → refund the reserve immediately.
        await failWithdrawal(admin, withdrawalId, result.message || 'Disbursement rejected', result.raw)
        return NextResponse.json(
          { error: result.message || 'Withdrawal could not be processed. You have not been charged.' },
          { status: 502 },
        )
      }

      // Accepted for processing. Store the provider reference so the result
      // webhook can correlate the async completion back to this withdrawal.
      await admin
        .from('withdrawals')
        .update({ provider_reference: result.reference ?? null })
        .eq('id', withdrawalId)

      return NextResponse.json({
        success: true,
        withdrawal_id: withdrawalId,
        status: 'processing',
        message: `Processing ${netAmount.toLocaleString()} ${currency} to ${phone_number}. You'll be notified once it completes.`,
        fee: feeAmount,
        net_amount: netAmount,
        provider_reference: result.reference ?? null,
      })
    } catch (e) {
      // Network/exception during disbursement → refund the reserve.
      console.error('Withdrawal disbursement error:', e)
      await failWithdrawal(admin, withdrawalId, 'Disbursement request failed', {
        error: e instanceof Error ? e.message : String(e),
      })
      return NextResponse.json(
        { error: 'Withdrawal could not be processed. You have not been charged.' },
        { status: 502 },
      )
    }
  } catch (error) {
    console.error('Withdraw route error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('withdrawals')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ withdrawals: data || [] })
}
