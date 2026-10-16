// app/api/cron/dispatch/route.ts
// ---------------------------------------------------------------------------
// ONE TICK OF THE SCHEDULER.
//
// The nine cron jobs were declared in vercel.json and nowhere else. The deploy
// path is Fly, Fly has no cron, and nothing in the app scheduled them — proven,
// not assumed: `job_runs` held ZERO rows, so no market had ever been
// auto-closed and no resolution had ever been attempted on a schedule.
//
// A dumb pinger (the `cron` process group in fly.toml) hits this once a minute.
// This route decides what is due and calls those routes. The jobs keep their
// own auth, their own observability and their own idempotency — this adds a
// clock, nothing else.
//
// WHY IT CALLS THE ROUTES OVER HTTP INSTEAD OF IMPORTING THEM
//
// Each worker is already a complete unit: CRON_SECRET auth, a `job_runs` row
// via withJobRun, structured logging, its own maxDuration. Importing the
// handlers would mean reconstructing a NextRequest for each and would silently
// bypass per-route runtime config. The call is to 127.0.0.1 inside the same
// machine, so the cost is a loopback request, and `job_runs` stays the single
// ledger for "did this job run" whether it was dispatched or triggered by hand.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAuthorizedCron, CRON_SECRET_HEADER } from '@/lib/cron-auth'
import { dueJobs, jobNames, type LastRunMap } from '@/lib/jobs/schedule'
import { logger } from '@/lib/observability/logger'
import { resolveRequestId } from '@/lib/observability/request-id'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Stop starting new jobs after this long.
 *
 * The pinger fires every 60 s and maxDuration is 60 s. Leaving headroom means a
 * slow job cannot make this tick overlap the next one — and because the next
 * tick cannot take the dispatch lock while this one holds it, an overrun would
 * silently skip a minute rather than queue.
 */
const BUDGET_MS = 40_000

/** Per-job ceiling, so one wedged worker cannot eat the whole tick. */
const JOB_TIMEOUT_MS = 25_000

function selfOrigin(): string {
  // Inside the machine. Not NEXT_PUBLIC_APP_URL: that points at the public
  // hostname, so every dispatch would leave the machine, cross Cloudflare and
  // come back — paying TLS and proxy latency to talk to itself, and failing
  // entirely if DNS or the edge is the thing that is broken.
  const port = process.env.PORT || '3000'
  return `http://127.0.0.1:${port}`
}

export async function GET(req: NextRequest) {
  const requestId = resolveRequestId(req.headers)
  const log = logger.child({ request_id: requestId, route: '/api/cron/dispatch' })

  const secret = process.env.CRON_SECRET
  if (!isAuthorizedCron(req.headers, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = await createAdminClient()

  // Lock + last-run map in one round trip (migration 118). A second dispatcher
  // on another machine gets locked=false and does nothing.
  const { data, error } = await sb.rpc('cron_dispatch_begin' as never, {} as never)
  if (error) {
    log.error('dispatch could not begin', { error: error.message })
    return NextResponse.json({ error: 'dispatch_begin_failed' }, { status: 500 })
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { locked?: boolean; last_runs?: LastRunMap }
    | null
  if (!row?.locked) {
    log.info('dispatch skipped: another dispatcher holds the lock')
    return NextResponse.json({ ok: true, skipped: 'locked', ran: [] })
  }

  // The scheduler respects the same flag the payment layer does
  // (lib/payments/mpesa.ts), so a soft launch cannot sweep deposits or push
  // payouts through a side door while the UI says payments are off.
  const paymentsLive = process.env.PAYMENTS_ENV === 'production'
  const disabled = (process.env.CRON_DISABLED_JOBS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const due = dueJobs(Date.now(), row.last_runs ?? {}, { paymentsLive, disabled })
  if (!due.length) {
    return NextResponse.json({ ok: true, ran: [], due: 0, paymentsLive })
  }

  const origin = selfOrigin()
  const started = Date.now()
  const ran: { job: string; status: number | 'timeout' | 'error'; ms: number }[] = []
  const skipped: string[] = []

  // Sequential, most overdue first. Parallel would multiply load on the same
  // database these jobs are already contending for, and the budget below is
  // easier to honour when one thing is in flight.
  for (const job of due) {
    if (Date.now() - started > BUDGET_MS) {
      skipped.push(job.name)
      continue
    }
    const t0 = Date.now()
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), JOB_TIMEOUT_MS)
    try {
      const res = await fetch(`${origin}/api/cron/${job.name}`, {
        method: 'GET',
        headers: { [CRON_SECRET_HEADER]: secret as string, 'x-request-id': requestId },
        signal: ac.signal,
        cache: 'no-store',
      })
      ran.push({ job: job.name, status: res.status, ms: Date.now() - t0 })
      if (!res.ok) log.warn('job returned non-2xx', { job: job.name, status: res.status })
    } catch (e) {
      const timedOut = e instanceof Error && e.name === 'AbortError'
      ran.push({ job: job.name, status: timedOut ? 'timeout' : 'error', ms: Date.now() - t0 })
      // A failing job must not stop the ones behind it: the loop continues.
      log.error('job dispatch failed', { job: job.name, error: e instanceof Error ? e.message : 'unknown' })
    } finally {
      clearTimeout(timer)
    }
  }

  log.info('dispatch tick complete', { ran: ran.length, skipped: skipped.length, paymentsLive })
  return NextResponse.json({
    ok: true,
    paymentsLive,
    known: jobNames().length,
    ran,
    skippedForBudget: skipped,
  })
}
