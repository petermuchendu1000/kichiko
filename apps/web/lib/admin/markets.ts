// lib/admin/markets.ts — Admin market queue query model (pure + server helpers).
//
// Pure param parsing / filter application so the market review queue is testable
// and consistent between the list page and any export. Mirrors lib/admin/users.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Enums } from '@/types/supabase'

export type MarketStatus = Enums<'market_status'>
export type MarketCategory = Enums<'market_category'>

export const MARKET_SORTS = [
  'created_at',
  'closes_at',
  'total_volume_usd',
  'total_bets',
  'unique_bettors',
] as const
export type MarketSort = (typeof MARKET_SORTS)[number]

const STATUSES = new Set<string>([
  'draft', 'pending', 'active', 'closed', 'resolved', 'disputed', 'cancelled',
])
const CATEGORIES = new Set<string>([
  'politics', 'sports', 'crypto', 'economics', 'entertainment',
  'technology', 'weather', 'other',
])

export interface MarketListParams {
  q: string | null
  status: MarketStatus | null
  category: MarketCategory | null
  featured: boolean | null
  sort: MarketSort
  dir: 'asc' | 'desc'
  page: number
  pageSize: number
}

export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 200

function oneOf<T extends string>(v: string | null | undefined, set: Set<string>): T | null {
  return v && set.has(v) ? (v as T) : null
}

/** Parse & clamp raw query params into a safe MarketListParams. */
export function parseMarketListParams(
  sp: Record<string, string | string[] | undefined> | URLSearchParams
): MarketListParams {
  const get = (k: string): string | null => {
    if (sp instanceof URLSearchParams) return sp.get(k)
    const v = sp[k]
    return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
  }
  const rawSort = get('sort')
  const sort: MarketSort = (MARKET_SORTS as readonly string[]).includes(rawSort ?? '')
    ? (rawSort as MarketSort)
    : 'created_at'
  const dir = get('dir') === 'asc' ? 'asc' : 'desc'
  const page = Math.max(1, parseInt(get('page') ?? '1', 10) || 1)
  const rawSize = parseInt(get('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize))
  const q = (get('q') ?? '').trim() || null
  const rawFeatured = get('featured')
  const featured = rawFeatured === 'true' ? true : rawFeatured === 'false' ? false : null
  return {
    q,
    status: oneOf<MarketStatus>(get('status'), STATUSES),
    category: oneOf<MarketCategory>(get('category'), CATEGORIES),
    featured,
    sort,
    dir,
    page,
    pageSize,
  }
}

export const MARKET_SELECT =
  'id, slug, title, category, status, creator_id, closes_at, resolves_at, resolved_at, resolved_outcome, yes_price, no_price, total_volume_usd, total_bets, unique_bettors, is_featured, is_trending, featured_order, created_at, creator:profiles!markets_creator_id_fkey(username, display_name)'

/**
 * Apply filters/sort/pagination to a markets query. Kept generic (`any`) to
 * avoid fighting the deeply-nested PostgREST builder types; the shape is covered
 * by MARKET_SELECT + tests on parseMarketListParams.
 */
export function applyMarketFilters(query: any, p: MarketListParams): any {
  let q = query
  if (p.q) {
    const term = `%${p.q.replace(/[%_]/g, (m) => '\\' + m)}%`
    q = q.or(`title.ilike.${term},slug.ilike.${term}`)
  }
  if (p.status) q = q.eq('status', p.status)
  if (p.category) q = q.eq('category', p.category)
  if (p.featured !== null) q = q.eq('is_featured', p.featured)
  q = q.order(p.sort, { ascending: p.dir === 'asc' })
  const from = (p.page - 1) * p.pageSize
  q = q.range(from, from + p.pageSize - 1)
  return q
}

export interface MarketRow {
  id: string
  slug: string | null
  title: string | null
  category: MarketCategory | null
  status: MarketStatus | null
  creator_id: string | null
  closes_at: string | null
  resolves_at: string | null
  resolved_at: string | null
  resolved_outcome: Enums<'order_side'> | null
  yes_price: number | null
  no_price: number | null
  total_volume_usd: number | null
  total_bets: number | null
  unique_bettors: number | null
  is_featured: boolean | null
  is_trending: boolean | null
  featured_order: number | null
  created_at: string | null
  creator: { username: string | null; display_name: string | null } | null
}

/** Fetch a filtered page of markets plus the total count for pagination. */
export async function fetchMarkets(
  supabase: SupabaseClient<Database>,
  p: MarketListParams
): Promise<{ rows: MarketRow[]; total: number }> {
  const base = supabase.from('markets').select(MARKET_SELECT, { count: 'exact' })
  const { data, count, error } = await applyMarketFilters(base, p)
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as unknown as MarketRow[], total: count ?? 0 }
}

/**
 * Which lifecycle actions are available for a market in `status`, mapped to the
 * capability they require. Pure so the detail page + tests agree on what an
 * operator may do. Superadmin/role gating is applied on top via capabilities.
 */
export interface MarketAction {
  key: 'approve' | 'reject' | 'close' | 'dispute' | 'resolve' | 'cancel' | 'void' | 'feature'
  label: string
  capability: 'markets:approve' | 'markets:resolve' | 'markets:cancel'
  danger?: boolean
}

export function availableMarketActions(status: MarketStatus): MarketAction[] {
  const actions: MarketAction[] = []
  if (status === 'draft' || status === 'pending') {
    actions.push({ key: 'approve', label: 'Approve', capability: 'markets:approve' })
    actions.push({ key: 'reject', label: 'Reject', capability: 'markets:approve', danger: true })
  }
  if (status === 'active') {
    actions.push({ key: 'close', label: 'Close early', capability: 'markets:approve' })
    actions.push({ key: 'dispute', label: 'Mark disputed', capability: 'markets:resolve' })
  }
  if (status === 'closed' || status === 'disputed') {
    actions.push({ key: 'resolve', label: 'Resolve', capability: 'markets:resolve' })
  }
  // Feature toggles apply to any non-terminal market.
  if (status !== 'resolved' && status !== 'cancelled') {
    actions.push({ key: 'feature', label: 'Feature / trend', capability: 'markets:approve' })
    // Cancel only succeeds while no positions exist (P0144 otherwise); a market
    // with positions is voided instead (migration 072, conserving 50-50 default).
    actions.push({ key: 'cancel', label: 'Cancel (no positions)', capability: 'markets:cancel', danger: true })
  }
  if (status === 'active' || status === 'closed' || status === 'disputed') {
    actions.push({ key: 'void', label: 'Void (settle at a price)', capability: 'markets:cancel', danger: true })
  }
  return actions
}
