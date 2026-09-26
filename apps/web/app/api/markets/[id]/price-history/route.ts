// app/api/markets/[id]/price-history/route.ts
// Public time-series of a market's YES/NO probability for charting.
// price_history is publicly readable (RLS: "Price history is publicly viewable"),
// so no auth is required. Accepts a market UUID or slug, supports a time window
// and even downsampling so large histories stay light for the chart.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PricePoint {
  yes_price: number
  no_price: number
  volume_usd: number | null
  recorded_at: string | null
}

/**
 * Evenly downsample a series to at most `maxPoints`, always preserving the
 * first and last samples so the chart's start/end line up with reality.
 */
function downsample<T>(rows: T[], maxPoints: number): T[] {
  if (maxPoints <= 0 || rows.length <= maxPoints) return rows
  const step = (rows.length - 1) / (maxPoints - 1)
  const out: T[] = []
  for (let i = 0; i < maxPoints; i++) out.push(rows[Math.round(i * step)])
  // De-dupe indices that round to the same row, keep last as final point.
  const seen = new Set<T>()
  const deduped = out.filter((r) => (seen.has(r) ? false : (seen.add(r), true)))
  if (deduped[deduped.length - 1] !== rows[rows.length - 1]) deduped.push(rows[rows.length - 1])
  return deduped
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'Market id or slug required' }, { status: 400 })

    const { searchParams } = new URL(req.url)
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '500', 10) || 500, 1), 5000)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const maxPoints = Math.min(Math.max(parseInt(searchParams.get('max_points') || '0', 10) || 0, 0), 2000)
    const optionId = searchParams.get('option')
    const OPT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

    const supabase = await createClient()

    // Resolve slug → market id (UUID can be used directly).
    let marketId = id
    if (!UUID_RE.test(id)) {
      const { data: market, error: mErr } = await supabase
        .from('markets')
        .select('id')
        .eq('slug', id)
        .maybeSingle()
      if (mErr) {
        console.error('Price-history market lookup error:', mErr)
        return NextResponse.json({ error: 'Failed to resolve market' }, { status: 500 })
      }
      if (!market) return NextResponse.json({ error: 'Market not found' }, { status: 404 })
      marketId = market.id
    }

    // Per-candidate history (multi-outcome / CLOB): price_history rows carry a
    // market_option_id and store the candidate's implied YES price in `price`.
    // Map it to the YES/NO shape the chart expects (NO = 1 − YES).
    const usingOption = !!optionId && OPT_RE.test(optionId)
    let query = usingOption
      ? supabase
          .from('price_history')
          .select('price, volume_usd, recorded_at')
          .eq('market_id', marketId)
          .eq('market_option_id', optionId!)
          .order('recorded_at', { ascending: false })
          .limit(limit)
      : supabase
          .from('price_history')
          .select('yes_price, no_price, volume_usd, recorded_at')
          .eq('market_id', marketId)
          .order('recorded_at', { ascending: false })
          .limit(limit)

    if (from) query = query.gte('recorded_at', from)
    if (to) query = query.lte('recorded_at', to)

    const { data, error } = await query
    if (error) {
      console.error('Price-history fetch error:', error)
      return NextResponse.json({ error: 'Failed to load price history' }, { status: 500 })
    }

    // The query takes the LATEST `limit` rows (newest first, audit 6.15: it
    // used to take the oldest, so a busy market's chart ended long ago); the
    // chart wants them oldest first.
    const rows = [...(data || [])].reverse()
    let points: PricePoint[] = usingOption
      ? (rows as { price: number | null; volume_usd: number | null; recorded_at: string | null }[]).map(
          (r) => ({
            yes_price: Number(r.price ?? 0),
            no_price: 1 - Number(r.price ?? 0),
            volume_usd: r.volume_usd,
            recorded_at: r.recorded_at,
          }),
        )
      : (rows as PricePoint[])
    const total = points.length
    if (maxPoints > 0) points = downsample(points, maxPoints)

    return NextResponse.json(
      {
        data: points,
        meta: { market_id: marketId, count: points.length, total, downsampled: points.length < total },
      },
      { headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=60' } },
    )
  } catch (error) {
    console.error('Price-history GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
