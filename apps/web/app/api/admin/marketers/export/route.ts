// GET /api/admin/marketers/export — CSV of the marketer directory.
import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { toCsv } from '@/lib/admin/csv'
import { describePlan } from '@/lib/admin/marketers'

export async function GET(_req: NextRequest) {
  const guard = await requireCapability('marketers:manage')
  if (!guard.ok) return guard.response

  const admin = await createAdminClient()
  const { data } = await admin
    .from('marketer_profiles')
    .select(
      'user_id, tracking_code, plan_key, commission_plan, hold_days, status, created_at, profiles!marketer_profiles_user_id_fkey(username, display_name, country_code, referral_count)'
    )
    .order('created_at', { ascending: false })
    .limit(1000)

  type Row = {
    user_id: string
    username: string
    display_name: string
    country: string
    tracking_code: string
    plan: string
    hold_days: number
    referrals: number
    status: string
    created_at: string
  }
  const rows: Row[] = (data ?? []).map((r) => {
    const p = (r as { profiles?: { username?: string; display_name?: string; country_code?: string; referral_count?: number } }).profiles
    return {
      user_id: r.user_id,
      username: p?.username ?? '',
      display_name: p?.display_name ?? '',
      country: p?.country_code ?? '',
      tracking_code: r.tracking_code,
      plan: describePlan(r.commission_plan),
      hold_days: r.hold_days,
      referrals: p?.referral_count ?? 0,
      status: r.status,
      created_at: r.created_at,
    }
  })

  const csv = toCsv<Row>(rows, [
    { key: 'user_id', header: 'User ID' },
    { key: 'username', header: 'Username' },
    { key: 'display_name', header: 'Display Name' },
    { key: 'country', header: 'Country' },
    { key: 'tracking_code', header: 'Tracking Code' },
    { key: 'plan', header: 'Commission Plan' },
    { key: 'hold_days', header: 'Hold Days' },
    { key: 'referrals', header: 'Referrals' },
    { key: 'status', header: 'Status' },
    { key: 'created_at', header: 'Approved' },
  ])

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="marketers-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
