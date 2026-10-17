// app/api/cron/btc-windows/route.ts — recurring BTC "Up or Down" engine tick.
//
// Scheduled every minute (pg_cron -> this endpoint with the CRON_SECRET header;
// see schedule_elopis_btc_jobs in migration 024). Each run:
//   1) ingests the last ~90s of Coinbase prints as per-second oracle ticks
//      (record_btc_ticks) so a 60-second TWAP has something to average,
//   2) fetches BTC/USD spot (Coinbase -> Kraken -> CoinGecko fallback) and
//      records it as a tick too (record_btc_tick), as the keep-alive that
//      survives a trade-feed outage,
//   3) auto-resolves any due windows against the recorded ticks
//      (resolve_btc_windows -> pays out via the audited resolve_market RPC),
//   4) rolls a fresh window per series as the prior one closes (open_btc_windows).
//
// ORDER MATTERS. Ingestion runs before settlement, because resolve_btc_windows
// prices a window on the 60 seconds ending at its close and will skip a window
// it cannot yet cover. Settlement runs before opening, so a window that closes
// and one that opens in the same minute both see the same tick history.
//
// Idempotent and safe to run concurrently. A price-source outage degrades the
// run to a partial no-op (no tick recorded) rather than failing hard — the next
// minute's run recovers automatically.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { withJobRun } from '@/lib/jobs/runner'
import { fetchBtcSpot, fetchBtcTradeTicks } from '@/lib/markets/btc-price'
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
      // 1) — per-second prints, so the TWAP has samples to weight.
      let ticks = 0
      try {
        const sampled = await fetchBtcTradeTicks(90)
        if (sampled.length > 0) {
          const { data, error } = await sb.rpc(
            'record_btc_ticks' as never,
            { p_ticks: sampled, p_source: 'coinbase-trades' } as never,
          )
          if (error) throw new Error(error.message)
          ticks = typeof data === 'number' ? data : 0
        }
      } catch (e) {
        // Non-fatal by design. The per-minute keep-alive tick below still
        // lands, windows already open on the spot rule still settle, and a
        // window that cannot be averaged is skipped rather than mispriced.
        log.warn('btc trade-tick ingest failed', { error: e instanceof Error ? e.message : 'unknown' })
      }

      // 2) — sample the spot price and record it as an oracle tick.
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
          ticks,
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
