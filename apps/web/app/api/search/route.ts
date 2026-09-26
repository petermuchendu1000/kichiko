import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseSearchParams, buildPagination } from '@/lib/search'
import { getCardOptions } from '@/lib/markets/card-options'

// Search reflects live market data; never statically cache.
export const dynamic = 'force-dynamic'

/**
 * GET /api/search
 * Relevance-ranked full-text market search backed by the `search_markets`
 * RPC (weighted tsvector + trigram fuzzy fallback, filters, pagination).
 *
 * Query params: q, category, status (active|closed|resolved|all),
 * sort (relevance|volume|newest|closing|bettors), page, per_page.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const p = parseSearchParams(searchParams)

  const supabase = await createClient()

  const { data, error } = await supabase.rpc('search_markets', {
    p_query: p.q,
    p_category: p.category,
    p_status: p.status,
    p_sort: p.sort,
    p_limit: p.limit,
    p_offset: p.offset,
  })

  if (error) {
    console.error('search failed:', error)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }

  const payload = (data ?? {}) as {
    data?: unknown[]
    total?: number
  }
  const rows = Array.isArray(payload.data) ? payload.data : []
  const total = typeof payload.total === 'number' ? payload.total : 0
  const pagination = buildPagination(total, p.page, p.perPage)

  // Attach each multiple_choice market's TOP options + option count so client
  // grids can render the Polymarket-style candidate rows (label · NN% · Yes/No)
  // instead of a meaningless binary bar.
  const typedRows = rows as { id: string; resolution_type?: string | null }[]
  const { topByMarket, countByMarket } = await getCardOptions(
    supabase,
    typedRows.filter((m) => m.resolution_type === 'multiple_choice').map((m) => m.id),
  )
  const enriched = typedRows.map((m) => {
    const top = topByMarket.get(m.id)
    return top && top.length
      ? { ...m, options: top, option_count: countByMarket.get(m.id) ?? null }
      : m
  })

  return NextResponse.json(
    {
      data: enriched,
      ...pagination,
      sort: p.sort,
      query: p.q,
    },
    {
      headers: {
        // Short private cache; results are user-agnostic but volatile.
        'Cache-Control': 'no-store',
      },
    }
  )
}
