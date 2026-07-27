// app/api/webhooks/mpesa-b2c/route.ts — M-Pesa B2C disbursement result
//
// SECURITY: this endpoint moves money OUT (it completes/refunds withdrawals),
// so a forged result is high-impact. Unlike deposits, Safaricom offers NO
// synchronous B2C status query (its Transaction Status API is itself async),
// so we cannot re-query authoritatively. The control here is SOURCE
// VERIFICATION: a shared-secret token on the ResultURL (+ optional IP
// allowlist), compared in constant time. When a control is configured we
// FAIL CLOSED on any unverified caller. When none is configured we log a loud
// security warning (the endpoint should not be relied on in production until
// MPESA_WEBHOOK_SECRET is set — see docs/GO-LIVE-PROVISIONING.md).
//
// We match the result to the pending withdrawal by the ConversationID stored
// as provider_reference, then funnel through the idempotent complete/fail RPCs:
//   ResultCode 0  → complete_withdrawal (release reserve, tally withdrawn)
//   ResultCode !0 → fail_withdrawal     (refund the reserve)
// Duplicate results are no-ops. We always answer {ResultCode:0}.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { parseMpesaB2CResult } from '@/lib/payments/mpesa'
import { completeWithdrawal, failWithdrawal } from '@/lib/payments/withdraw'
import { verifyMpesaWebhookSource } from '@/lib/payments/mpesa-webhook-verify'

const ACCEPTED = { ResultCode: 0, ResultDesc: 'Accepted' }

export async function POST(req: NextRequest) {
  try {
    // Money-OUT: enforce source verification when configured; fail closed.
    const source = verifyMpesaWebhookSource(req)
    if (!source.ok) {
      console.warn('M-Pesa B2C result rejected: source verification failed', {
        reason: source.reason,
      })
      return NextResponse.json(ACCEPTED)
    }
    if (!source.enforced) {
      // Not a blocker (would halt all live payouts), but a real security gap.
      console.warn(
        'SECURITY: M-Pesa B2C result endpoint is UNVERIFIED — set MPESA_WEBHOOK_SECRET ' +
          '(and optionally MPESA_WEBHOOK_IP_ALLOWLIST) before relying on it in production.',
      )
    }

    const body = await req.json().catch(() => ({}))
    const admin = await createAdminClient()
    const result = parseMpesaB2CResult(body)

    const reference = result.conversationId
    if (!reference) {
      console.error('M-Pesa B2C result: missing ConversationID')
      return NextResponse.json(ACCEPTED)
    }

    const { data: withdrawal } = await admin
      .from('withdrawals')
      .select('id, status')
      .eq('provider_reference', reference)
      .maybeSingle()

    if (!withdrawal) {
      console.error('M-Pesa B2C result: withdrawal not found for', reference)
      return NextResponse.json(ACCEPTED)
    }

    if (result.success) {
      await completeWithdrawal(admin, {
        withdrawalId: withdrawal.id,
        providerReference: result.transactionId ?? reference,
        providerReceipt: result.transactionReceipt ?? null,
        rawResponse: body,
      })
    } else {
      await failWithdrawal(
        admin,
        withdrawal.id,
        result.resultDesc || 'M-Pesa B2C disbursement failed',
        body,
      )
    }

    return NextResponse.json(ACCEPTED)
  } catch (error) {
    console.error('M-Pesa B2C webhook error:', error)
    return NextResponse.json(ACCEPTED)
  }
}
