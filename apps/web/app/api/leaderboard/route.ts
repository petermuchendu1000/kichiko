import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseLeaderboardParams, type LeaderboardEntry } from '@/lib/leaderboard'
import { presetHeaders } from '@/lib/http/cache-headers'

// Leaderboard reflects live standings; render dynamically.
export const dynamic = 'force-dynamic'

/**
 * GET /api/leaderboard
 * Ranked traders by metric (volume|winrate|pnl) and period (all|week|month).
 * All-time reads the `leaderboard` materialized view; week/month aggregate
 * from transactions via the `get_leaderboard` RPC.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const { metric, period, limit } = parseLeaderboardParams(searchParams)

  const supabase = await createClient()

  const { data, error } = await supabase.rpc('get_leaderboard', {
    p_metric: metric,
    p_period: period,
    p_limit: limit,
  })

  if (error) {
    console.error('leaderboard query failed:', error)
    return NextResponse.json({ error: 'Failed to load the leaderboard' }, { status: 500 })
  }

  const payload = (data ?? {}) as { data?: LeaderboardEntry[] }
  const rows = Array.isArray(payload.data) ? payload.data : []

  // Public, non-user data → briefly edge-cacheable with stale-while-revalidate.
  return NextResponse.json(
    { data: rows, metric, period, count: rows.length },
    { headers: presetHeaders('leaderboard') }
  )
}
