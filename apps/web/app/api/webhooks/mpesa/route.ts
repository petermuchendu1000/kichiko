// app/api/webhooks/mpesa/route.ts — M-Pesa STK (Lipa na M-Pesa) callback
//
// SECURITY: Safaricom's STK callback is unsigned and its ResultCode is NOT
// trusted. We ALWAYS re-query the authoritative STK status server→server
// (queryMpesaSTKStatus) and drive the credit/fail decision purely off that —
// exactly like the PesaPal/MTN handlers. A forged `ResultCode:0` payload can
// therefore never credit a wallet. Source verification (shared secret / IP
// allowlist) is applied as defense-in-depth.
//
// Idempotent + atomic: success funnels through creditDeposit() (credit_deposit
// RPC keyed on the server-known CheckoutRequestID) and failures through
// failDeposit(). Retried callbacks are no-ops. We always answer M-Pesa with
// {ResultCode:0} so Safaricom stops retrying.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { parseMpesaCallback, queryMpesaSTKStatus } from '@/lib/payments/mpesa'
import { creditDeposit, failDeposit } from '@/lib/payments/credit'
import { verifyMpesaWebhookSource } from '@/lib/payments/mpesa-webhook-verify'
import type { CurrencyCode } from '@/types'

const ACCEPTED = { ResultCode: 0, ResultDesc: 'Accepted' }

export async function POST(req: NextRequest) {
  try {
    // Defense-in-depth: drop forged callers when a source control is configured.
    const source = verifyMpesaWebhookSource(req)
    if (!source.ok) {
      console.warn('M-Pesa STK callback rejected: source verification failed', {
        reason: source.reason,
      })
      return NextResponse.json(ACCEPTED)
    }

    const body = await req.json().catch(() => ({}))
    const adminClient = await createAdminClient()

    // Best-effort parse (a genuine callback carries the stkCallback envelope).
    let parsed: ReturnType<typeof parseMpesaCallback> | null = null
    try {
      parsed = parseMpesaCallback(body)
    } catch {
      parsed = null
    }

    // Locate the deposit by the deposit_id we appended to the callback URL, or
    // by the CheckoutRequestID Safaricom echoes back.
    const depositIdParam = (() => {
      try {
        return new URL(req.url).searchParams.get('deposit_id')
      } catch {
        return null
      }
    })()

    let deposit:
      | { id: string; status: string | null; amount: number; currency: string; checkout_request_id: string | null }
      | null = null

    if (depositIdParam) {
      const { data } = await adminClient
        .from('deposits')
        .select('id, status, amount, currency, checkout_request_id')
        .eq('id', depositIdParam)
        .maybeSingle()
      deposit = data
    }
    if (!deposit && parsed?.checkoutRequestId) {
      const { data } = await adminClient
        .from('deposits')
        .select('id, status, amount, currency, checkout_request_id')
        .eq('checkout_request_id', parsed.checkoutRequestId)
        .maybeSingle()
      deposit = data
    }

    if (!deposit) {
      console.error(
        'M-Pesa callback: deposit not found for',
        depositIdParam || parsed?.checkoutRequestId || '(unknown)',
      )
      return NextResponse.json(ACCEPTED)
    }

    // The CheckoutRequestID we use for the authoritative query is the one we
    // stored when initiating the push (server-known) — never taken on trust
    // from the payload alone.
    const checkoutRequestId = deposit.checkout_request_id || parsed?.checkoutRequestId
    if (!checkoutRequestId) {
      console.error('M-Pesa callback: no CheckoutRequestID to verify deposit', deposit.id)
      return NextResponse.json(ACCEPTED)
    }

    // Authoritative status — trust the provider, not the payload.
    let query: Awaited<ReturnType<typeof queryMpesaSTKStatus>>
    try {
      query = await queryMpesaSTKStatus(checkoutRequestId)
    } catch {
      // Still processing / transient query error → no-op; Safaricom will retry
      // the callback, and the deposit reconciliation sweep can settle it later.
      console.warn('M-Pesa callback: STK status query unavailable; leaving pending', deposit.id)
      return NextResponse.json(ACCEPTED)
    }

    const resultCode = Number(query.ResultCode)

    if (resultCode === 0) {
      // Success confirmed by the provider → atomic, idempotent credit. The key
      // is the server-known CheckoutRequestID so duplicates collide.
      await creditDeposit(adminClient, {
        depositId: deposit.id,
        amount: Number(deposit.amount),
        currency: deposit.currency as CurrencyCode,
        providerReceipt: parsed?.mpesaReceiptNumber ?? null,
        rawCallback: { callback: body, query },
        idempotencyKey: `mpesa_${checkoutRequestId}`,
      })
    } else {
      // Provider confirms a terminal non-zero result → mark failed (idempotent;
      // never clobbers an already-credited deposit).
      await failDeposit(
        adminClient,
        deposit.id,
        query.ResultDesc || parsed?.resultDesc || 'M-Pesa payment failed',
        { callback: body, query },
      )
    }

    return NextResponse.json(ACCEPTED)
  } catch (error) {
    console.error('M-Pesa webhook error:', error)
    // Always 200 to M-Pesa to prevent infinite retries; we log for ops.
    return NextResponse.json(ACCEPTED)
  }
}
