// app/api/webhooks/mtn-momo/route.ts — MTN MoMo collection callback
//
// Idempotent + atomic via the shared creditDeposit()/failDeposit() helpers.
// MTN's callback can be lightweight, so we authoritatively re-query the
// collection status before crediting (defends against spoofed callbacks).
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getMoMoPaymentStatus } from '@/lib/payments/mtn-momo'
import { creditDeposit, failDeposit } from '@/lib/payments/credit'
import type { CurrencyCode } from '@/types'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const adminClient = await createAdminClient()

    const { searchParams } = new URL(req.url)
    const referenceId = searchParams.get('ref') || body.externalId || body.referenceId

    if (!referenceId) {
      return NextResponse.json({ received: true })
    }

    const { data: deposit } = await adminClient
      .from('deposits')
      .select('id, status, amount, currency')
      .eq('mtn_reference_id', referenceId)
      .maybeSingle()

    if (!deposit) {
      console.error('MTN callback: deposit not found for', referenceId)
      return NextResponse.json({ received: true })
    }

    // Trust the provider, not the payload: re-query the authoritative status.
    // The re-query result drives the credit/fail decision — the raw callback
    // body is NEVER trusted to move money.
    let status: string | undefined
    let financialTransactionId = body.financialTransactionId as string | undefined
    let reason = body.reason as string | undefined
    try {
      const live = await getMoMoPaymentStatus(referenceId)
      status = live.status
      financialTransactionId = live.financialTransactionId ?? financialTransactionId
      reason = live.reason ?? reason
    } catch {
      // F4: the authoritative status re-query failed/threw. Do NOT fall back to
      // trusting the spoofable callback body (that could credit a wallet off a
      // forged payload). Leave the deposit PENDING (no-op), ack MTN so it
      // retries, and let the reconciliation sweep settle it later. Mirrors the
      // M-Pesa deposit handler.
      console.warn('MTN callback: status query unavailable; leaving pending', deposit.id)
      return NextResponse.json({ received: true })
    }

    if (status === 'SUCCESSFUL') {
      await creditDeposit(adminClient, {
        depositId: deposit.id,
        amount: Number(deposit.amount),
        currency: deposit.currency as CurrencyCode,
        providerReceipt: financialTransactionId ?? null,
        rawCallback: body,
        idempotencyKey: `mtn_${referenceId}`,
      })
    } else if (status === 'FAILED') {
      await failDeposit(adminClient, deposit.id, reason || 'MTN MoMo payment failed', body)
    }
    // else still pending → no-op, provider will call again.

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('MTN MoMo webhook error:', error)
    return NextResponse.json({ received: true })
  }
}
