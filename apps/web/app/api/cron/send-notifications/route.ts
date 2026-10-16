// app/api/cron/send-notifications/route.ts — notification delivery worker.
//
// Triggered on a schedule (Supabase scheduled function / Vercel Cron / external
// pinger) with the shared CRON_SECRET. Claims a batch of due deliveries from the
// outbox, dispatches each via its provider (Resend / Africa's Talking), and
// records the outcome with exponential backoff. Idempotent & parallel-safe
// (claim uses FOR UPDATE SKIP LOCKED); provider outages never touch user requests.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { sendSMS } from '@/lib/notifications/sms'
import { sendEmail } from '@/lib/notifications/email'
import {
  backoffSeconds,
  isValidDestination,
  truncateSms,
  summarizeBatch,
  type DeliveryChannel,
} from '@/lib/notifications/delivery'
import { renderNotificationEmail } from '@/lib/notifications/templates/render'
import { logger } from '@/lib/observability/logger'
import { resolveRequestId } from '@/lib/observability/request-id'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface ClaimedDelivery {
  id: string
  notification_id: string
  user_id: string
  channel: DeliveryChannel
  destination: string
  attempts: number
  max_attempts: number
  title: string
  body: string
  data: Record<string, unknown> | null
  type: string
}

async function handle(req: NextRequest) {
  const requestId = resolveRequestId(req.headers)
  const log = logger.child({ request_id: requestId, route: '/api/cron/send-notifications' })

  if (!isAuthorizedCron(req.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit')) || 50, 1), 500)
  const sb = await createAdminClient()

  const { data, error } = await sb.rpc('claim_notification_deliveries' as never, { p_limit: limit } as never)
  if (error) {
    log.error('claim failed', { error: error.message })
    return NextResponse.json({ error: 'claim_failed', request_id: requestId }, { status: 500 })
  }
  const claimed = (data as ClaimedDelivery[] | null) ?? []

  const outcomes: { status: 'sent' | 'failed' | 'skipped' }[] = []

  for (const d of claimed) {
    // Permanently-invalid destinations: record failure without hammering the provider.
    if (!isValidDestination(d.channel, d.destination)) {
      await complete(sb, d.id, false, null, `invalid ${d.channel} destination`, d.attempts)
      outcomes.push({ status: d.attempts >= d.max_attempts ? 'failed' : 'failed' })
      continue
    }

    try {
      let ok = false
      let providerMessageId: string | null = null

      if (d.channel === 'sms') {
        const message = truncateSms(`${d.title}: ${d.body}`)
        ok = await sendSMS(d.destination, message)
      } else if (d.channel === 'email') {
        // Branded, per-type template (lib/notifications/templates). This used
        // to be `<p>${escapeHtml(body)}</p>` — an unstyled paragraph for every
        // type, including deposits, withdrawals and wins. For money mail that
        // is a security problem as much as a design one: a message with no
        // sender identity is indistinguishable from one somebody else sent.
        // The renderer escapes its own inputs and falls back to a generic
        // branded card for any type it does not know, so an unrecognised type
        // still sends rather than throwing in the worker.
        const mail = renderNotificationEmail({
          type: d.type,
          title: d.title,
          body: d.body,
          data: d.data,
        })
        ok = await sendEmail({
          to: d.destination,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
        })
      } else {
        // push not yet implemented — mark failed (won't be enqueued by policy).
        ok = false
      }

      await complete(sb, d.id, ok, providerMessageId, ok ? null : 'provider returned failure', d.attempts)
      outcomes.push({ status: ok ? 'sent' : 'failed' })
    } catch (e) {
      await complete(sb, d.id, false, null, e instanceof Error ? e.message : 'dispatch error', d.attempts)
      outcomes.push({ status: 'failed' })
    }
  }

  const summary = summarizeBatch(outcomes)
  log.info('notification dispatch complete', { ...summary })
  return NextResponse.json({ ok: true, ...summary, request_id: requestId })
}

async function complete(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  id: string,
  success: boolean,
  providerMessageId: string | null,
  error: string | null,
  attempts: number
) {
  await sb.rpc('complete_notification_delivery' as never, {
    p_id: id,
    p_success: success,
    p_provider_message_id: providerMessageId,
    p_error: error,
    p_backoff_seconds: backoffSeconds(attempts),
  } as never)
}

export async function POST(req: NextRequest) {
  return handle(req)
}

// Some schedulers only issue GET — accept both.
export async function GET(req: NextRequest) {
  return handle(req)
}
