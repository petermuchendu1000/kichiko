// GET /api/admin/creators/export — CSV of the creator directory.
import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '@/lib/auth'
import { toCsv } from '@/lib/admin/csv'
import { collectExportRows, exportFailure } from '@/lib/admin/export-pages'

export async function GET(_req: NextRequest) {
  const guard = await requireCapability('creators:manage')
  if (!guard.ok) return guard.response

  // audit 6.39: every creator, not the first 1,000
  let data
  try {
    data = await collectExportRows(
      async (from, to) => {
        const { data: rows, count, error } = await guard.ctx.supabase
          .from('creator_profiles')
          .select(
            'user_id, tier, reward_pct, auto_publish, max_open_markets, status, created_at, profiles!creator_profiles_user_id_fkey(username, display_name, country_code)',
            { count: 'exact' }
          )
          .order('created_at', { ascending: false })
          .order('user_id')
          .range(from, to)
        return { rows: rows ?? [], total: count, error: error?.message }
      },
      (r) => r.user_id
    )
  } catch (e) {
    return exportFailure(e, 'creators')
  }

  type Row = {
    user_id: string
    username: string
    display_name: string
    country: string
    tier: string
    reward_pct: number | null
    auto_publish: boolean
    max_open_markets: number | null
    status: string
    created_at: string
  }
  const rows: Row[] = (data ?? []).map((r) => {
    const p = (r as { profiles?: { username?: string; display_name?: string; country_code?: string } }).profiles
    return {
      user_id: r.user_id,
      username: p?.username ?? '',
      display_name: p?.display_name ?? '',
      country: p?.country_code ?? '',
      tier: r.tier,
      reward_pct: r.reward_pct,
      auto_publish: r.auto_publish,
      max_open_markets: r.max_open_markets,
      status: r.status,
      created_at: r.created_at,
    }
  })

  const csv = toCsv<Row>(rows, [
    { key: 'user_id', header: 'User ID' },
    { key: 'username', header: 'Username' },
    { key: 'display_name', header: 'Display Name' },
    { key: 'country', header: 'Country' },
    { key: 'tier', header: 'Tier' },
    { key: 'reward_pct', header: 'Reward Override' },
    { key: 'auto_publish', header: 'Auto Publish' },
    { key: 'max_open_markets', header: 'Max Open Markets' },
    { key: 'status', header: 'Status' },
    { key: 'created_at', header: 'Approved' },
  ])

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="creators-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
