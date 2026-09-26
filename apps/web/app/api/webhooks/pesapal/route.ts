// app/api/webhooks/pesapal/route.ts — PesaPal v3 IPN handler
//
// PesaPal calls this URL (GET by default) with OrderTrackingId +
// OrderMerchantReference whenever a transaction's status changes. The IPN
// payload is NOT signed and NOTHING in it is trusted:
//   * the deposit is found ONLY by the tracking id stored when we created the
//     order (deposits.pesapal_order_id), never by the request's merchant
//     reference (audit 6.3: paying a $1 order and naming an unpaid $50,000
//     deposit as the merchant reference credited the $50,000);
//   * GetTransactionStatus is re-queried server->server, and its merchant
//     reference must be this deposit's id, its amount this deposit's amount
//     and (when reported) its currency this deposit's currency;
//   * the credit is idempotent per deposit (pesapal_<deposit id>).
//
// PesaPal expects a specific JSON acknowledgement so it stops retrying.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { parsePesaPalIpn, getPesaPalStatus } from '@/lib/payments/pesapal'
import { creditDeposit, failDeposit } from '@/lib/payments/credit'
import { pesapalMismatch } from '@/lib/payments/deposit-settle'
import type { CurrencyCode } from '@/types'

async function handle(
  orderTrackingId: string | undefined,
  merchantReference: string | undefined,
  notificationType: string | undefined,
) {
  const ack = {
    orderNotificationType: notificationType || 'IPNCHANGE',
    orderTrackingId: orderTrackingId || '',
    orderMerchantReference: merchantReference || '',
    status: 200,
  }

  if (!orderTrackingId) return ack

  const adminClient = await createAdminClient()

  // Locate the deposit by the tracking id WE stored for it (never by the
  // request's merchant reference).
  const { data: deposit } = await adminClient
    .from('deposits')
    .select('id, status, amount, currency')
    .eq('pesapal_order_id', orderTrackingId)
    .maybeSingle()

  if (!deposit) {
    console.error('PesaPal IPN: deposit not found', { orderTrackingId, merchantReference })
    return ack
  }

  // Authoritative status check, bound to THIS deposit.
  const live = await getPesaPalStatus(orderTrackingId)
  const mismatch = pesapalMismatch(live, deposit)
  if (mismatch) {
    console.error('PesaPal IPN: status does not match the deposit; not applied', {
      depositId: deposit.id, orderTrackingId, mismatch, merchantReference,
    })
    return ack
  }

  if (live.status === 'COMPLETED') {
    await creditDeposit(adminClient, {
      depositId: deposit.id,
      amount: Number(deposit.amount),
      currency: deposit.currency as CurrencyCode,
      providerReceipt: live.confirmationCode ?? orderTrackingId,
      rawCallback: live.raw,
      idempotencyKey: `pesapal_${deposit.id}`,
    })
  } else if (live.status === 'FAILED' || live.status === 'INVALID' || live.status === 'REVERSED') {
    await failDeposit(adminClient, deposit.id, `PesaPal ${live.status}`, live.raw)
  }
  // PENDING → no-op.

  return ack
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const { orderTrackingId, merchantReference, notificationType } = parsePesaPalIpn({
      query: searchParams,
    })
    return NextResponse.json(await handle(orderTrackingId, merchantReference, notificationType))
  } catch (error) {
    console.error('PesaPal IPN (GET) error:', error)
    return NextResponse.json({ status: 500 }, { status: 200 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { searchParams } = new URL(req.url)
    const { orderTrackingId, merchantReference, notificationType } = parsePesaPalIpn({
      query: searchParams,
      body,
    })
    return NextResponse.json(await handle(orderTrackingId, merchantReference, notificationType))
  } catch (error) {
    console.error('PesaPal IPN (POST) error:', error)
    return NextResponse.json({ status: 500 }, { status: 200 })
  }
}
