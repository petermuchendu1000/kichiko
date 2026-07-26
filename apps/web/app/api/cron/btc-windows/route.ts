// app/api/cron/btc-windows/route.ts — recurring BTC "Up or Down" engine tick.
//
// Scheduled every minute (pg_cron -> this endpoint with the CRON_SECRET header;
// see schedule_kichiko_btc_jobs in migration 024). Each run:
//   1) fetches BTC/USD spot (Coinbase -> Kraken -> CoinGecko fallback),
//   2) records it as an oracle tick (record_btc_tick),
//   3) auto-resolves any due windows against the recorded ticks
//      (resolve_btc_windows -> pays out via the audited resolve_market RPC),
//   4) rolls a fresh window per series as the prior one closes (open_btc_windows).
//
// Idempotent and safe to run concurrently. A price-source outage degrades the
// run to a partial no-op (no tick recorded) rather than failing hard — the next
// minute's run recovers automatically.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/jobs/runner'
import { fetchBtcSpot } from '@/lib/markets/btc-price'
import { logger } from '@/lib/observability/logger'
import { resolveRequestId } from '@/lib/observability/request-id'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const JOB_NAME = 'btc-windows'

async function handle(req: NextRequest) {
  const requestId = resolveRequestId(req.headers)
  const log = logger.child({ request_id: requestId, route: '/api/cron/btc-windows' })

  if (!isAuthorizedCron(req.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sb = await createAdminClient()

  try {
    const outcome = await withJobRun(sb, JOB_NAME, requestId, async () => {
      // 1) + 2) — sample the spot price and record it as an oracle tick.
      let price: number | null = null
      let priceSource: string | null = null
      try {
        const spot = await fetchBtcSpot()
        price = spot.price
        priceSource = spot.source
        const { error } = await sb.rpc(
          'record_btc_tick' as never,
          { p_price: price, p_source: priceSource } as never,
        )
        if (error) throw new Error(error.message)
      } catch (e) {
        // Degrade gracefully: skip this tick, let resolve/open no-op, recover next run.
        log.warn('btc price sample failed', { error: e instanceof Error ? e.message : 'unknown' })
      }

      // 3) — settle any due windows from the recorded ticks (audited payouts).
      const { data: resolved, error: rErr } = await sb.rpc('resolve_btc_windows' as never, {} as never)
      if (rErr) throw new Error(`resolve_btc_windows: ${rErr.message}`)

      // 4) — roll a fresh window per series as the prior one closes.
      const { data: opened, error: oErr } = await sb.rpc('open_btc_windows' as never, {} as never)
      if (oErr) throw new Error(`open_btc_windows: ${oErr.message}`)

      const r = (resolved as { resolved?: number; skipped?: number } | null) ?? {}
      const o = (opened as { opened?: number; reason?: string } | null) ?? {}
      return {
        status: (price == null ? 'partial' : 'success') as 'partial' | 'success',
        result: {
          price,
          price_source: priceSource,
          resolved: r.resolved ?? 0,
          skipped: r.skipped ?? 0,
          opened: o.opened ?? 0,
          open_reason: o.reason ?? null,
        },
      }
    })
    log.info('btc-windows complete', { ...outcome.result })
    return NextResponse.json({ ok: true, ...outcome.result, request_id: requestId })
  } catch (e) {
    log.error('btc-windows failed', { error: e instanceof Error ? e.message : 'unknown' })
    return NextResponse.json({ error: 'btc_windows_failed', request_id: requestId }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  return handle(req)
}

// Some schedulers only issue GET — accept both.
export async function GET(req: NextRequest) {
  return handle(req)
}
