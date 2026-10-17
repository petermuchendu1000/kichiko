// app/api/webhooks/africastalking/dlr/route.ts — SMS delivery reports.
//
// WHY THIS ENDPOINT MATTERS
// A send that comes back `101 Sent` means Africa's Talking handed the message
// to the telco. It does not mean a handset received it. Without this callback
// the outbox's `sent` is a statement about our own API call, and "we sent you
// an SMS with your withdrawal confirmation" is something we would be saying on
// no evidence.
//
// AUTHENTICATION
// Africa's Talking does not sign delivery reports and will not send a custom
// header, so the only control available is a secret inside the callback URL we
// register with them. It fails CLOSED: an unauthenticated caller here can mark
// a payout SMS failed, which is a misleading audit trail and a support call.
//
// The body is still not trusted after that. Only the message id is used, and
// only to find a row we ourselves created; `record_sms_delivery_report` will
// not insert, so a report for an id we never sent changes nothing.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyWebhookToken } from '@/lib/security/webhook-token'
import { parseDeliveryReport, dlrOutcome } from '@/lib/notifications/africastalking'
import { logger } from '@/lib/observability/logger'
import { resolveRequestId } from '@/lib/observability/request-id'

export const dynamic = 'force-dynamic'

/** AT retries anything that is not 2xx, so everything we have handled says 200. */
const ACK = NextResponse.json({ received: true })

export async function POST(req: NextRequest) {
  const log = logger.child({
    request_id: resolveRequestId(req.headers),
    route: '/api/webhooks/africastalking/dlr',
  })

  const auth = verifyWebhookToken(req, process.env.AFRICASTALKING_WEBHOOK_SECRET)
  if (!auth.ok) {
    log.warn('delivery report rejected', { reason: auth.reason })
    // 401, not 200: a rejected report should keep being retried once the
    // secret is configured rather than being silently thrown away.
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Documented as JSON, posted as form-encoded in practice. Accept both rather
  // than betting on one and dropping every report if it is the other.
  let payload: Record<string, unknown> = {}
  try {
    const type = req.headers.get('content-type') || ''
    if (type.includes('application/json')) {
      payload = (await req.json()) as Record<string, unknown>
    } else {
      payload = Object.fromEntries(new URLSearchParams(await req.text()))
    }
  } catch {
    return NextResponse.json({ error: 'Unreadable body' }, { status: 400 })
  }

  const report = parseDeliveryReport(payload)
  if (!report) {
    log.warn('delivery report missing id or status')
    // 200: a malformed body will be malformed on every retry too.
    return ACK
  }

  const outcome = dlrOutcome(report.status)

  try {
    const sb = await createAdminClient()
    const { data, error } = await sb.rpc('record_sms_delivery_report' as never, {
      p_provider_message_id: report.messageId,
      p_status: report.status,
      p_outcome: outcome,
      p_failure_reason: report.failureReason,
      p_network_code: report.networkCode,
    } as never)
    if (error) throw new Error(error.message)

    const matched = (data as { matched?: boolean } | null)?.matched === true
    log.info('delivery report recorded', {
      provider_message_id: report.messageId,
      provider_status: report.status,
      outcome,
      matched,
      // Never the phone number itself: this log is read by more people than
      // the account holder.
      network_code: report.networkCode,
    })
    return ACK
  } catch (err) {
    log.error('delivery report failed', { error: err instanceof Error ? err.message : 'unknown' })
    // 500 so Africa's Talking retries. Swallowing this with a 200 would turn a
    // transient database error into a delivery whose real outcome is lost.
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}

/** Some AT account configurations issue GET during callback validation. */
export async function GET(req: NextRequest) {
  const auth = verifyWebhookToken(req, process.env.AFRICASTALKING_WEBHOOK_SECRET)
  return auth.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
