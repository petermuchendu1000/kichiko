// GET /api/admin/users/export — CSV export of the current user filter set.
import { NextRequest, NextResponse } from 'next/server'
import { requireCapability } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { parseUserListParams, fetchUsers, MAX_PAGE_SIZE, type UserRow } from '@/lib/admin/users'
import { toCsv } from '@/lib/admin/csv'

export async function GET(req: NextRequest) {
  const guard = await requireCapability('users:read')
  if (!guard.ok) return guard.response

  const params = parseUserListParams(req.nextUrl.searchParams)
  // Export up to MAX_PAGE_SIZE rows of the current filter (first page window).
  const { rows } = await fetchUsers(await createAdminClient(), { ...params, page: 1, pageSize: MAX_PAGE_SIZE })

  const csv = toCsv<UserRow>(rows, [
    { key: 'id', header: 'ID' },
    { key: 'username', header: 'Username' },
    { key: 'display_name', header: 'Display Name' },
    { key: 'phone_number', header: 'Phone' },
    { key: 'country_code', header: 'Country' },
    { key: 'preferred_currency', header: 'Currency' },
    { key: 'role', header: 'Role' },
    { key: 'account_status', header: 'Status' },
    { key: 'kyc_status', header: 'KYC' },
    { key: 'total_volume_usd', header: 'Volume USD' },
    { key: 'total_bets', header: 'Bets' },
    { key: 'profit_loss_usd', header: 'P/L USD' },
    { key: 'referral_code', header: 'Referral Code' },
    { key: 'referral_count', header: 'Referrals' },
    { key: 'created_at', header: 'Joined' },
    { key: 'last_login_at', header: 'Last Login' },
  ])

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="users-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
