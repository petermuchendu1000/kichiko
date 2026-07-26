// ============================================================
// Kichiko - Module 10: Search (pure logic)
// Query sanitization, param parsing/validation, pagination math,
// highlight segmentation, and a client-side relevance ranker that
// mirrors the server's weighting (title > tags > description).
// Kept side-effect free so it is fully unit-testable.
// ============================================================
import type { MarketCategory } from '@/types'
import { CATEGORY_LABELS } from '@/types'

export const SEARCH_SORTS = ['relevance', 'volume', 'newest', 'closing', 'bettors'] as const
export type SearchSort = (typeof SEARCH_SORTS)[number]

export const SEARCH_STATUSES = ['active', 'closed', 'resolved', 'all'] as const
export type SearchStatus = (typeof SEARCH_STATUSES)[number]

export const MARKET_CATEGORIES = Object.keys(CATEGORY_LABELS) as MarketCategory[]

export const DEFAULT_PER_PAGE = 20
export const MAX_PER_PAGE = 50
export const MAX_QUERY_LEN = 100

/** Trim, collapse internal whitespace, strip control chars, cap length. */
export function sanitizeQuery(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY_LEN)
}

/** Clamp an int-ish value into [min, max], falling back to `fallback`. */
export function clampInt(
  value: string | number | null | undefined,
  min: number,
  max: number,
  fallback: number
): number {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.trunc(n), min), max)
}

export function normalizeSort(raw: string | null | undefined): SearchSort {
  return SEARCH_SORTS.includes(raw as SearchSort) ? (raw as SearchSort) : 'relevance'
}

export function normalizeStatus(raw: string | null | undefined): SearchStatus {
  return SEARCH_STATUSES.includes(raw as SearchStatus) ? (raw as SearchStatus) : 'active'
}

export function normalizeCategory(raw: string | null | undefined): MarketCategory | null {
  if (!raw || raw === 'all') return null
  return MARKET_CATEGORIES.includes(raw as MarketCategory) ? (raw as MarketCategory) : null
}

export interface ParsedSearchParams {
  q: string
  category: MarketCategory | null
  status: SearchStatus
  sort: SearchSort
  page: number
  perPage: number
  limit: number
  offset: number
}

/** Validate + normalize raw request params into a safe, bounded shape. */
export function parseSearchParams(sp: URLSearchParams): ParsedSearchParams {
  const q = sanitizeQuery(sp.get('q'))
  const category = normalizeCategory(sp.get('category'))
  const status = normalizeStatus(sp.get('status'))
  // An explicit query with no sort chosen ranks by relevance; otherwise volume.
  const rawSort = sp.get('sort')
  const sort = rawSort ? normalizeSort(rawSort) : q ? 'relevance' : 'volume'
  const page = clampInt(sp.get('page'), 1, 100000, 1)
  const perPage = clampInt(sp.get('per_page'), 1, MAX_PER_PAGE, DEFAULT_PER_PAGE)
  return {
    q,
    category,
    status,
    sort,
    page,
    perPage,
    limit: perPage,
    offset: (page - 1) * perPage,
  }
}

export interface Pagination {
  total: number
  page: number
  per_page: number
  total_pages: number
  has_next: boolean
  has_prev: boolean
}

export function buildPagination(total: number, page: number, perPage: number): Pagination {
  const safeTotal = Math.max(0, Math.trunc(total))
  const totalPages = perPage > 0 ? Math.ceil(safeTotal / perPage) : 0
  return {
    total: safeTotal,
    page,
    per_page: perPage,
    total_pages: totalPages,
    has_next: page < totalPages,
    has_prev: page > 1,
  }
}

// ---------- Highlight segmentation (for the results UI) ----------

export interface HighlightSegment {
  text: string
  match: boolean
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Split `text` into segments, flagging spans that match any query token. */
export function splitHighlight(text: string, query: string): HighlightSegment[] {
  const tokens = sanitizeQuery(query)
    .split(' ')
    .filter((t) => t.length >= 2)
    .map(escapeRegExp)
  if (!text) return []
  if (tokens.length === 0) return [{ text, match: false }]
  const re = new RegExp(`(${tokens.join('|')})`, 'ig')
  return text
    .split(re)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, match: re.test(part) && new RegExp(re.source, 'i').test(part) }))
}

// ---------- Client-side relevance ranker (mirror of server weights) ----------

export interface RankableMarket {
  title: string
  description?: string | null
  tags?: string[] | null
  total_volume_usd?: number | null
}

/**
 * Pure relevance score mirroring the SQL weighting: a match in the title
 * dominates a tag match, which dominates a description match. Volume is a
 * small tie-breaker. Used for client-side re-ranking / tests.
 */
export function relevanceScore(market: RankableMarket, query: string): number {
  const tokens = sanitizeQuery(query).toLowerCase().split(' ').filter(Boolean)
  if (tokens.length === 0) return 0
  const title = (market.title || '').toLowerCase()
  const desc = (market.description || '').toLowerCase()
  const tags = (market.tags || []).join(' ').toLowerCase()
  let score = 0
  for (const t of tokens) {
    if (title.includes(t)) score += 10
    if (tags.includes(t)) score += 4
    if (desc.includes(t)) score += 2
  }
  // tiny volume tiebreak (never enough to overturn a weight tier)
  score += Math.min((market.total_volume_usd || 0) / 1_000_000, 0.9)
  return score
}

export function rankByRelevance<T extends RankableMarket>(items: T[], query: string): T[] {
  return [...items].sort((a, b) => relevanceScore(b, query) - relevanceScore(a, query))
}
