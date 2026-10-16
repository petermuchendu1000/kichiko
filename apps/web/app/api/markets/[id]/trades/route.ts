// app/api/markets/[id]/trades/route.ts — recent trades for the on-chart ticker.
//
// The ticker's first frame is server-rendered with the page; this is how it
// stays live afterwards. Same shape as the book route next door: cookieless
// anon client (market_activity is public-read since migration 001), an
// in-process slug cache, and a short shared cache so N open tabs on the same
// market cost one query.
//
// `since` is a hint, not a licence: lib/markets/trade-ticker.ts clamps it to
// the recency window, so a client cannot ask for older trades than the ticker
// is allowed to claim are live.
//
// Gated on `flags.live_trade_ticker`. That flag is a jurisdiction switch (see
// the helper's header and ruling K7) — when a Kenyan entity turns it off this
// route stops serving, so the animation cannot be revived from the client.
import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getTickerTrades, TICKER_MAX, type TickerTrade } from '@/lib/markets/trade-ticker'
import { isFeatureEnabled } from '@/lib/flags'
import { TtlCache } from '@/lib/ttl-cache'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/

const markets = new TtlCache<string | null>(5 * 60_000, 2000)
const trades = new TtlCache<TickerTrade[]>(2000, 2000)
/** The flag is an ops switch, not a per-request decision; 30 s is plenty. */
const flag = new TtlCache<boolean>(30_000, 4)

let anon: SupabaseClient | null = null
function publicClient(): SupabaseClient {
  anon ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  return anon
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = publicClient()

    const on = await flag.get('live_trade_ticker', () =>
      isFeatureEnabled(supabase as never, 'flags.live_trade_ticker'),
    )
    // 200 with an empty list, not 403: the ticker being off is a normal state
    // of the product, and a polling client should quietly render nothing
    // rather than log an error every few seconds.
    if (!on) {
      return NextResponse.json(
        { trades: [], enabled: false },
        { headers: { 'Cache-Control': 'public, s-maxage=30' } },
      )
    }

    const sinceRaw = new URL(req.url).searchParams.get('since')
    const since = sinceRaw && ISO_RE.test(sinceRaw) ? sinceRaw : undefined

    const marketId = await markets.get(
      id,
      async () => {
        const sel = supabase.from('markets').select('id')
        const { data, error } = await (UUID_RE.test(id) ? sel.eq('id', id) : sel.eq('slug', id)).maybeSingle()
        if (error) throw error
        return ((data as { id: string } | null)?.id) ?? null
      },
      (v) => v !== null,
    )
    if (!marketId) return NextResponse.json({ error: 'Market not found' }, { status: 404 })

    // Cached on the market alone, then filtered per caller. `since` varies by
    // client and would shatter the cache; the window's worth of trades is at
    // most TICKER_MAX rows, so filtering here is free.
    const recent = await trades.get(marketId, () =>
      getTickerTrades(supabase as never, marketId, { limit: TICKER_MAX }),
    )
    const out = since ? recent.filter((t) => t.at > since) : recent

    return NextResponse.json(
      { trades: out, enabled: true },
      { headers: { 'Cache-Control': 'public, s-maxage=2, stale-while-revalidate=8' } },
    )
  } catch (error) {
    console.error('Trades route error:', error)
    return NextResponse.json({ error: 'Failed to load trades' }, { status: 500 })
  }
}
