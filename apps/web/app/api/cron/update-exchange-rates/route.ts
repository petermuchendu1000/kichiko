// app/api/cron/update-exchange-rates/route.ts — refresh local->USD FX rates.
//
// Fetches quotes from the official central-bank sources and an independent
// aggregator (lib/integrations/fx-sources.ts), then sends EVERY observation to
// the service-role-only upsert_fx_observations RPC. The database decides what
// is accepted (migrations 075/076: sanity bands, move and consensus gates,
// official quotes preferred) and records every quote in fx_observations. A
// held or rejected quote keeps the last good rate. Fails safe: with no
// observations at all nothing is written and the run is recorded 'partial'.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/jobs/runner'
import { fetchFxObservations } from '@/lib/integrations/fx-sources'
import { logger } from '@/lib/observability/logger'
import { resolveRequestId } from '@/lib/observability/request-id'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const JOB_NAME = 'update-exchange-rates'

async function handle(req: NextRequest) {
  const requestId = resolveRequestId(req.headers)
  const log = logger.child({ request_id: requestId, route: '/api/cron/update-exchange-rates' })

  if (!isAuthorizedCron(req.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = await createAdminClient()

  try {
    const outcome = await withJobRun(sb, JOB_NAME, requestId, async () => {
      const results = await fetchFxObservations()
      const observations = results.flatMap((r) => r.observations)
      const sourceErrors = Object.fromEntries(results.filter((r) => r.error).map((r) => [r.source, r.error]))

      if (observations.length === 0) {
        return {
          status: 'partial' as const,
          result: { accepted: 0, held: 0, rejected: 0, observations: 0, source_errors: sourceErrors, note: 'no observations; nothing written' },
        }
      }

      const { data, error } = await sb.rpc('upsert_fx_observations' as never, { p_obs: observations } as never)
      if (error) throw new Error((error as { message?: string }).message ?? 'upsert_fx_observations failed')
      const r = (data as { accepted?: number; held?: number; rejected?: number; currencies?: unknown } | null) ?? {}
      const held = (r.held ?? 0) + (r.rejected ?? 0)
      return {
        status: (held > 0 || Object.keys(sourceErrors).length > 0 ? 'partial' : 'success') as 'partial' | 'success',
        result: {
          accepted: r.accepted ?? 0,
          held: r.held ?? 0,
          rejected: r.rejected ?? 0,
          observations: observations.length,
          source_errors: sourceErrors,
          currencies: r.currencies ?? {},
        },
      }
    })
    log.info('update-exchange-rates complete', { ...outcome.result })
    return NextResponse.json({ ok: true, ...outcome.result, request_id: requestId })
  } catch (e) {
    log.error('update-exchange-rates failed', { error: e instanceof Error ? e.message : 'unknown' })
    return NextResponse.json({ error: 'update_exchange_rates_failed', request_id: requestId }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  return handle(req)
}

export async function GET(req: NextRequest) {
  return handle(req)
}
