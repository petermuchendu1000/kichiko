// app/api/cron/payouts/route.ts — send queued payouts and settle unsettled ones
// (migration 083; audit 6.6, 6.10). Scheduled every minute by
// schedule_kichiko_jobs ('kichiko-payouts'); CRON_SECRET-gated.
//
//   1. dispatch: claim queued withdrawals (approved after review, retried,
//      or not sent by the request) and send them. A claim is atomic, so a
//      withdrawal is sent by exactly one caller.
//   2. status sweep: stale sends become 'unknown'; sent/unknown payouts due
//      for a check are queried at the provider (backoff) and settled only on
//      an authoritative answer.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { withJobRun, deriveJobStatus } from '@/lib/jobs/runner'
import { runPayoutDispatch, runPayoutStatusSweep } from '@/lib/payments/payouts'
import { logger } from '@/lib/observability/logger'
import { resolveRequestId } from '@/lib/observability/request-id'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const JOB_NAME = 'payouts'

async function handle(req: NextRequest) {
  const requestId = resolveRequestId(req.headers)
  const log = logger.child({ request_id: requestId, route: '/api/cron/payouts' })

  if (!isAuthorizedCron(req.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get('limit')) || 20, 1), 50)
  const sb = await createAdminClient()

  try {
    const outcome = await withJobRun(sb, JOB_NAME, requestId, async () => {
      const sent = await runPayoutDispatch(sb, limit)
      const checks = await runPayoutStatusSweep(sb, limit * 2)
      const dispatched = {
        accepted: sent.filter((s) => s.outcome === 'accepted').length,
        rejected: sent.filter((s) => s.outcome === 'rejected').length,
        unknown: sent.filter((s) => s.outcome === 'unknown').length,
        unrecorded: sent.filter((s) => !s.recorded).length,
      }
      return {
        status: deriveJobStatus({ succeeded: sent.length - dispatched.unrecorded, failed: dispatched.unrecorded + checks.query_failed }),
        result: { dispatched, checks },
      }
    })
    log.info('payouts complete', { ...outcome.result })
    return NextResponse.json({ ok: true, ...outcome.result, request_id: requestId })
  } catch (e) {
    log.error('payouts failed', { error: e instanceof Error ? e.message : 'unknown' })
    return NextResponse.json({ error: 'payouts_failed', request_id: requestId }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  return handle(req)
}

export async function GET(req: NextRequest) {
  return handle(req)
}
