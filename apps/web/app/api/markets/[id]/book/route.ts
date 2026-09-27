// app/api/markets/[id]/book/route.ts — public CLOB order-book depth.
// Aggregated depth for one (market, candidate, side) book via the SECURITY
// DEFINER clob_get_book RPC (no counterparty identity leaks). Response is
// shaped with PM's cumulative TOTAL column + depth-bar ratios (lib/clob).
//
// Every open market page polls this every 4s, and the database is a long round
// trip away (eu-west-1), so the route does as little network work as it can:
//   - the book is the same for every caller, so it uses a cookieless anon
//     client (no session handling; middleware also skips the session check);
//   - slug -> (id, engine) never changes, so it is cached in-process (5 min);
//   - the shaped book is cached for 1s and concurrent callers share one RPC.
import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { shapeBook, type ClobBook, type RawClobBook } from '@/lib/clob'
import { TtlCache } from '@/lib/ttl-cache'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type MarketRef = { id: string; pricing_engine: string | null } | null
const markets = new TtlCache<MarketRef>(5 * 60_000, 2000)
const books = new TtlCache<ClobBook>(1000, 2000)

let anon: SupabaseClient | null = null
function publicClient(): SupabaseClient {
  anon ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return anon
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const option = searchParams.get('option')
    const side = (searchParams.get('side') || 'yes').toLowerCase()

    if (side !== 'yes' && side !== 'no') {
      return NextResponse.json({ error: 'side must be yes or no' }, { status: 400 })
    }
    if (!option || !UUID_RE.test(option)) {
      return NextResponse.json({ error: 'option (market_option_id) is required' }, { status: 400 })
    }

    const supabase = publicClient()

    // Resolve market by UUID or slug; verify it is an order-book market.
    const mkt = await markets.get(id, async () => {
      const sel = supabase.from('markets').select('id, pricing_engine')
      const { data, error } = await (UUID_RE.test(id) ? sel.eq('id', id) : sel.eq('slug', id)).maybeSingle()
      if (error) throw error
      return (data as MarketRef) ?? null
    }, (v) => v !== null) // never cache a miss: a market can be published later
    if (!mkt) return NextResponse.json({ error: 'Market not found' }, { status: 404 })
    if (mkt.pricing_engine !== 'clob') {
      return NextResponse.json({ error: 'This market is not an order-book market' }, { status: 409 })
    }

    const book = await books.get(`${mkt.id}:${option}:${side}`, async () => {
      const { data: raw, error } = await supabase.rpc('clob_get_book', {
        p_market_id: mkt.id,
        p_market_option_id: option,
        p_outcome_side: side,
      })
      if (error) throw error
      return shapeBook(raw as unknown as RawClobBook)
    })

    return NextResponse.json(book, {
      headers: { 'Cache-Control': 'public, s-maxage=1, stale-while-revalidate=4' },
    })
  } catch (error) {
    console.error('Book route error:', error)
    return NextResponse.json({ error: 'Failed to load order book' }, { status: 500 })
  }
}
