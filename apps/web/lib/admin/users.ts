// lib/admin/users.ts — User directory query model (pure + server helpers).
//
// Pure param parsing / filter application so the list is testable and consistent
// between the page (server component) and the CSV export route.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Enums } from '@/types/supabase'

export type UserRole = Enums<'user_role'>
export type AccountStatus = Enums<'account_status'>
export type KycStatus = Enums<'kyc_status'>

export const USER_SORTS = ['created_at', 'total_volume_usd', 'total_bets', 'username'] as const
export type UserSort = (typeof USER_SORTS)[number]

export interface UserListParams {
  q: string | null
  role: UserRole | null
  status: AccountStatus | null
  kyc: KycStatus | null
  country: string | null
  sort: UserSort
  dir: 'asc' | 'desc'
  page: number
  pageSize: number
  offset?: number // exports: an explicit row offset (overrides page)
}

export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 200

const ROLES = new Set<string>([
  'user', 'admin', 'moderator', 'resolver', 'creator', 'marketer', 'support', 'finance', 'superadmin',
])
const STATUSES = new Set<string>(['active', 'suspended', 'closed'])
const KYCS = new Set<string>(['unverified', 'pending', 'verified', 'rejected'])

function oneOf<T extends string>(v: string | null | undefined, set: Set<string>): T | null {
  return v && set.has(v) ? (v as T) : null
}

/** Parse & clamp raw query params into a safe UserListParams. */
export function parseUserListParams(
  sp: Record<string, string | string[] | undefined> | URLSearchParams
): UserListParams {
  const get = (k: string): string | null => {
    if (sp instanceof URLSearchParams) return sp.get(k)
    const v = sp[k]
    return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
  }
  const rawSort = get('sort')
  const sort: UserSort = (USER_SORTS as readonly string[]).includes(rawSort ?? '')
    ? (rawSort as UserSort)
    : 'created_at'
  const dir = get('dir') === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, parseInt(get('page') ?? '1', 10) || 1)
  const rawSize = parseInt(get('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize))
  const q = (get('q') ?? '').trim() || null
  const country = (get('country') ?? '').trim().toUpperCase().slice(0, 2) || null
  return {
    q,
    role: oneOf<UserRole>(get('role'), ROLES),
    status: oneOf<AccountStatus>(get('status'), STATUSES),
    kyc: oneOf<KycStatus>(get('kyc'), KYCS),
    country,
    sort,
    dir,
    page,
    pageSize,
  }
}

export const USER_SELECT =
  'id, username, display_name, phone_number, country_code, preferred_currency, role, kyc_status, account_status, total_volume_usd, total_bets, win_rate, profit_loss_usd, referral_code, referral_count, created_at, last_login_at'

/**
 * Apply filters/sort/pagination to a profiles query. Kept generic (`any`) to
 * avoid fighting the deeply-nested PostgREST builder types; the shape is covered
 * by USER_SELECT + tests on parseUserListParams.
 */
export function applyUserFilters(query: any, p: UserListParams): any {
  let q = query
  if (p.q) {
    // ILIKE across username / display_name / phone / referral_code.
    const term = `%${p.q.replace(/[%_]/g, (m) => '\\' + m)}%`
    q = q.or(
      `username.ilike.${term},display_name.ilike.${term},phone_number.ilike.${term},referral_code.ilike.${term}`
    )
  }
  if (p.role) q = q.eq('role', p.role)
  if (p.status) q = q.eq('account_status', p.status)
  if (p.kyc) q = q.eq('kyc_status', p.kyc)
  if (p.country) q = q.eq('country_code', p.country)
  q = q.order(p.sort, { ascending: p.dir === 'asc' }).order('id') // id: stable pages
  const from = p.offset ?? (p.page - 1) * p.pageSize
  q = q.range(from, from + p.pageSize - 1)
  return q
}

export interface UserRow {
  id: string
  username: string | null
  display_name: string | null
  phone_number: string | null
  country_code: string | null
  preferred_currency: string | null
  role: UserRole | null
  kyc_status: KycStatus | null
  account_status: AccountStatus | null
  total_volume_usd: number | null
  total_bets: number | null
  win_rate: number | null
  profit_loss_usd: number | null
  referral_code: string | null
  referral_count: number | null
  created_at: string | null
  last_login_at: string | null
}

/** Fetch a filtered page of users plus the total count for pagination. */
export async function fetchUsers(
  supabase: SupabaseClient<Database>,
  p: UserListParams
): Promise<{ rows: UserRow[]; total: number }> {
  const base = supabase.from('profiles').select(USER_SELECT, { count: 'exact' })
  const { data, count, error } = await applyUserFilters(base, p)
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as UserRow[], total: count ?? 0 }
}
