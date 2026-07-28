// app/api/webhooks/airtel-disbursement/route.ts — Airtel Money disbursement result
//
// Airtel calls this callback with the payout outcome. We match it to the
// pending withdrawal by the transaction id we stored as provider_reference,
// re-query the authoritative status (defence against spoofed callbacks), then
// funnel through the idempotent complete/fail RPCs:
//   status_code TS → complete_withdrawal (release reserve)
//   status_code TF → fail_withdrawal     (refund the reserve)
// Unknown codes are still pending → no-op.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { parseAirtelCallback, airtelTransactionStatus } from '@/lib/payments/airtel-money'
import { completeWithdrawal, failWithdrawal } from '@/lib/payments/withdraw'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const admin = await createAdminClient()
    const parsed = parseAirtelCallback(body)

    const reference = parsed.reference || new URL(req.url).searchParams.get('ref') || undefined
    if (!reference) {
      console.error('Airtel disbursement result: missing reference')
      return NextResponse.json({ received: true })
    }

    const { data: withdrawal } = await admin
      .from('withdrawals')
      .select('id, status')
      .eq('provider_reference', reference)
      .maybeSingle()

    if (!withdrawal) {
      console.error('Airtel disbursement result: withdrawal not found for', reference)
      return NextResponse.json({ received: true })
    }

    // H1 (money-OUT): NEVER settle from the raw callback body — it is
    // unauthenticated, so a forged { status_code:'TF' } would refund a reserve
    // while Airtel already paid out (double-spend), and a forged 'TS' would
    // finalize prematurely. Re-query Airtel's authoritative status and drive
    // complete/fail off THAT only. If the re-query is unavailable, leave the
    // withdrawal pending (no-op) — Airtel will call again — rather than trusting
    // the body. Mirrors the mtn-disbursement handler.
    let live: { status: string; airtelMoneyId?: string }
    try {
      live = await airtelTransactionStatus(reference)
    } catch (err) {
      console.error(
        'Airtel disbursement result: status re-query unavailable, staying pending for',
        reference,
        err,
      )
      return NextResponse.json({ received: true })
    }

    if (live.status === 'TS') {
      await completeWithdrawal(admin, {
        withdrawalId: withdrawal.id,
        providerReference: reference,
        providerReceipt: live.airtelMoneyId ?? parsed.airtelMoneyId ?? null,
        rawResponse: body,
      })
    } else if (live.status === 'TF') {
      await failWithdrawal(
        admin,
        withdrawal.id,
        parsed.message || 'Airtel Money disbursement failed',
        body,
      )
    }
    // else still pending → no-op.

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Airtel disbursement webhook error:', error)
    return NextResponse.json({ received: true })
  }
}
