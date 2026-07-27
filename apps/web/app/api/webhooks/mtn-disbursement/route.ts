// app/api/webhooks/mtn-disbursement/route.ts — MTN MoMo disbursement result
//
// SECURITY (money-OUT): MTN calls this callback with the transfer outcome, but
// the callback body is UNAUTHENTICATED. We must NOT settle a withdrawal from
// body.status — a forged { status:'SUCCESSFUL', referenceId } would release a
// reserve. We match the callback to the pending withdrawal by the
// X-Reference-Id we stored as provider_reference, then RE-QUERY MTN's
// authoritative disbursement status (GET /transfer/{referenceId}) and settle
// off that, funnelling through the idempotent complete/fail RPCs:
//   status SUCCESSFUL → complete_withdrawal (release reserve)
//   status FAILED     → fail_withdrawal     (refund the reserve)
// Anything else (or an unavailable re-query) is still pending → no-op (MTN will
// call again). This mirrors the airtel-disbursement and mtn-momo handlers.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getMoMoTransferStatus } from '@/lib/payments/mtn-momo'
import { completeWithdrawal, failWithdrawal } from '@/lib/payments/withdraw'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>))
    const admin = await createAdminClient()

    const { searchParams } = new URL(req.url)
    const reference =
      searchParams.get('ref') ||
      (body.referenceId as string | undefined) ||
      (body.externalId as string | undefined)

    if (!reference) {
      console.error('MTN disbursement result: missing reference')
      return NextResponse.json({ received: true })
    }

    const { data: withdrawal } = await admin
      .from('withdrawals')
      .select('id, status')
      .eq('provider_reference', reference)
      .maybeSingle()

    if (!withdrawal) {
      console.error('MTN disbursement result: withdrawal not found for', reference)
      return NextResponse.json({ received: true })
    }

    // Money-OUT: NEVER settle from the raw callback body — it is unauthenticated
    // and a forged { status:'SUCCESSFUL', referenceId } would release a reserve.
    // Re-query MTN's authoritative disbursement status (GET /transfer/{ref}) and
    // drive complete/fail off THAT, mirroring the airtel-disbursement and
    // mtn-momo (collection) handlers. If the re-query is unavailable we leave the
    // withdrawal pending (no-op) rather than trust the body — MTN will call again.
    let live: { status: string; financialTransactionId?: string; reason?: string }
    try {
      live = await getMoMoTransferStatus(reference)
    } catch (err) {
      console.error(
        'MTN disbursement result: status re-query unavailable, staying pending for',
        reference,
        err,
      )
      return NextResponse.json({ received: true })
    }

    if (live.status === 'SUCCESSFUL') {
      await completeWithdrawal(admin, {
        withdrawalId: withdrawal.id,
        providerReference: reference,
        providerReceipt: live.financialTransactionId ?? null,
        rawResponse: body,
      })
    } else if (live.status === 'FAILED') {
      await failWithdrawal(
        admin,
        withdrawal.id,
        live.reason || 'MTN MoMo disbursement failed',
        body,
      )
    }
    // else still pending → no-op.

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('MTN disbursement webhook error:', error)
    return NextResponse.json({ received: true })
  }
}
