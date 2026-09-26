// app/api/cron/deposit-sweep/route.ts — settle deposits whose callback never
// came by asking the provider (deposit half of audit 6.10; migration 084).
// Scheduled every 2 minutes by schedule_kichiko_jobs ('kichiko-deposit-sweep');
// CRON_SECRET-gated. Settles only on an authoritative answer, through the same
// idempotent credit/fail RPCs and idempotency keys as the webhooks.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { withJobRun, deriveJobStatus } from '@/lib/jobs/runner'
import { runDepositStatusSweep } from '@/lib/payments/deposit-settle'
import { logger } from '@/lib/observability/logger'
import { resolveRequestId } from '@/lib/observability/request-id'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const JOB_NAME = 'deposit-sweep'

async function handle(req: NextRequest) {
  const requestId = resolveRequestId(req.headers)
  const log = logger.child({ request_id: requestId, route: '/api/cron/deposit-sweep' })

  if (!isAuthorizedCron(req.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get('limit')) || 50, 1), 200)
  const sb = await createAdminClient()

  try {
    const outcome = await withJobRun(sb, JOB_NAME, requestId, async () => {
      const counts = await runDepositStatusSweep(sb, limit)
      const ok = counts.credit + counts.fail + counts.pending + counts.no_reference + counts.unsupported
      return {
        status: deriveJobStatus({ succeeded: ok, failed: counts.query_failed + counts.errors + counts.mismatch }),
        result: { ...counts },
      }
    })
    log.info('deposit-sweep complete', { ...outcome.result })
    return NextResponse.json({ ok: true, ...outcome.result, request_id: requestId })
  } catch (e) {
    log.error('deposit-sweep failed', { error: e instanceof Error ? e.message : 'unknown' })
    return NextResponse.json({ error: 'deposit_sweep_failed', request_id: requestId }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  return handle(req)
}

export async function GET(req: NextRequest) {
  return handle(req)
}
