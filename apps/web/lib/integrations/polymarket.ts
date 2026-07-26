// lib/integrations/polymarket.ts
//
// Thin, typed client for Polymarket's FREE public APIs (no key required):
//   • Gamma  (markets/events metadata):   https://gamma-api.polymarket.com
//   • CLOB   (prices/order book):         https://clob.polymarket.com
//
// Used by the Markets module to optionally seed/mirror real-world markets
// (e.g. elections, crypto, sports) into Kichiko. We never place orders on
// Polymarket — this is read-only ingestion of market metadata + prices.
//
// Docs: https://docs.polymarket.com/

const GAMMA_BASE = process.env.POLYMARKET_GAMMA_URL || 'https://gamma-api.polymarket.com'
const CLOB_BASE = process.env.POLYMARKET_CLOB_URL || 'https://clob.polymarket.com'

export interface PolymarketMarket {
  id: string
  question: string
  description?: string
  slug?: string
  category?: string
  active?: boolean
  closed?: boolean
  endDate?: string
  // JSON-encoded string arrays in Gamma responses
  outcomes?: string
  outcomePrices?: string
  volume?: string | number
  liquidity?: string | number
  conditionId?: string
  clobTokenIds?: string
}

export interface NormalizedMarket {
  source: 'polymarket'
  externalId: string
  question: string
  description: string
  category: string
  closesAt: string | null
  yesPrice: number | null
  noPrice: number | null
  volumeUsd: number
  active: boolean
  closed: boolean
}

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', ...(init?.headers || {}) },
    // Cache at the framework layer; ingestion jobs override as needed.
    next: { revalidate: 300 },
  } as RequestInit)
  if (!res.ok) {
    throw new Error(`Polymarket ${res.status} ${res.statusText} for ${url}`)
  }
  return res.json() as Promise<T>
}

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : fallback
}

function parseJsonArray(s?: string): unknown[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** Map Polymarket Gamma categories onto Kichiko market_category enum. */
export function mapCategory(c?: string): string {
  const k = (c || '').toLowerCase()
  if (/elect|politic|gov/.test(k)) return 'politics'
  if (/sport|nba|nfl|soccer|football/.test(k)) return 'sports'
  if (/crypto|bitcoin|eth/.test(k)) return 'crypto'
  if (/econ|fed|inflation|gdp/.test(k)) return 'economics'
  if (/tech|ai/.test(k)) return 'technology'
  if (/entertain|movie|music|oscar/.test(k)) return 'entertainment'
  if (/weather|climate|hurricane/.test(k)) return 'weather'
  if (/business|earnings|ipo/.test(k)) return 'business'
  if (/health|covid|disease/.test(k)) return 'health'
  return 'other'
}

/** Normalize a raw Gamma market into our ingestion shape (binary YES/NO). */
export function normalizeMarket(m: PolymarketMarket): NormalizedMarket {
  const prices = parseJsonArray(m.outcomePrices).map((p) => num(p))
  const yesPrice = prices.length >= 1 ? prices[0] : null
  const noPrice = prices.length >= 2 ? prices[1] : yesPrice != null ? 1 - yesPrice : null
  return {
    source: 'polymarket',
    externalId: m.id,
    question: m.question,
    description: m.description || '',
    category: mapCategory(m.category),
    closesAt: m.endDate || null,
    yesPrice,
    noPrice,
    volumeUsd: num(m.volume),
    active: Boolean(m.active),
    closed: Boolean(m.closed),
  }
}

export const polymarket = {
  /** List markets from Gamma. Supports common filters. */
  async listMarkets(params: {
    limit?: number
    active?: boolean
    closed?: boolean
    order?: string
    ascending?: boolean
  } = {}): Promise<PolymarketMarket[]> {
    const qs = new URLSearchParams()
    qs.set('limit', String(params.limit ?? 50))
    if (params.active !== undefined) qs.set('active', String(params.active))
    if (params.closed !== undefined) qs.set('closed', String(params.closed))
    if (params.order) qs.set('order', params.order)
    if (params.ascending !== undefined) qs.set('ascending', String(params.ascending))
    return getJSON<PolymarketMarket[]>(`${GAMMA_BASE}/markets?${qs.toString()}`)
  },

  /** Fetch a single market by Gamma id. */
  async getMarket(id: string): Promise<PolymarketMarket> {
    return getJSON<PolymarketMarket>(`${GAMMA_BASE}/markets/${encodeURIComponent(id)}`)
  },

  /** Live midpoint price for a CLOB token id (0..1). */
  async getMidpoint(tokenId: string): Promise<number | null> {
    const data = await getJSON<{ mid?: string }>(
      `${CLOB_BASE}/midpoint?token_id=${encodeURIComponent(tokenId)}`
    )
    return data.mid ? num(data.mid, NaN) || null : null
  },

  normalizeMarket,
  mapCategory,
}

export default polymarket
