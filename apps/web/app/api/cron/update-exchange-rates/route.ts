// app/api/cron/update-exchange-rates/route.ts — refresh local->USD FX rates.
//
// Scheduled every ~6h. Fetches live USD-base quotes from OpenExchangeRates,
// inverts them to the canonical local->USD form, and upserts via the
// service-role-only upsert_exchange_rates RPC. Fails safe: if the provider is
// unreachable or no key is configured we DO NOT clobber good rows with stale
// fallbacks — the run is recorded 'partial' and the DB keeps its last-known-good
// values (the anon-readable rates the UI relies on stay intact).
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/jobs/runner'
import { fetchUsdRates, toUpsertRows, fetchUsdKesReference } from '@/lib/integrations/fx'
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
      const fx = await fetchUsdRates()

      // Record the live USD/KES *market* reference as a human-readable mirror.
      // The authoritative KES conversion rate is the KES row in exchange_rates,
      // which fetchUsdRates now refreshes live like every other currency.
      const ref = await fetchUsdKesReference()
      if (ref) {
        await sb
          .from('platform_settings')
          .upsert(
            {
              key: 'fx.usd_kes_reference',
              value: { usd_to_kes: ref.usdToKes, source: ref.source, as_of: ref.asOf },
              is_public: true,
            } as never,
            { onConflict: 'key' } as never,
          )
      }

      // No live rates -> skip the upsert entirely (don't overwrite good data).
      if (fx.live.length === 0) {
        return {
          status: 'partial' as const,
          result: { upserted: 0, skipped: 0, live: 0, source: fx.source, note: 'no live rates; upsert skipped' },
        }
      }

      const rows = toUpsertRows(fx.rates).filter((r) => fx.live.includes(r.from_currency))
      const { data, error } = await sb.rpc('upsert_exchange_rates' as never, {
        p_rates: rows,
        p_source: fx.source,
      } as never)
      if (error) throw new Error(error.message)
      const r = (data as { upserted?: number; skipped?: number } | null) ?? {}
      return {
        status: 'success' as const,
        result: { upserted: r.upserted ?? 0, skipped: r.skipped ?? 0, live: fx.live.length, source: fx.source },
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
