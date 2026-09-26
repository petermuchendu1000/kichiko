// lib/integrations/fx-sources.ts — official FX sources for the settlement currencies.
//
// Source hierarchy (docs/research/engine-2026-09/14-FX-SOURCES.md §5):
//   KES          Central Bank of Kenya (CBK) daily mean, table 193
//   UGX TZS BIF  CBK's official KES/<ccy> cross rates x KES per USD (Bank of
//                Uganda has no machine-readable feed; BoT is HTML behind a form;
//                BRB publishes PDFs)
//   RWF          National Bank of Rwanda (BNR) exchange-rate API, and the CBK cross
//   ETB          National Bank of Ethiopia (NBE) weighted average
//   ZMW          no official JSON feed (Bank of Zambia publishes XLSX): aggregator only
//   all seven    fawazahmed0 currency-api (CC0), an independent aggregator used
//                as the cross-check source
//
// Every source yields observations in ONE unit, units of the currency per 1 USD,
// with the publisher's value date. The database decides what to accept
// (upsert_fx_observations: sanity bands, move and consensus gates, official
// quotes preferred). Parsers are pure and tested against real recorded
// responses (lib/integrations/__fixtures__/fx). Fetchers never throw.

import type { CurrencyCode } from '@/types'

export interface FxObservation {
  currency: CurrencyCode
  /** units of `currency` per 1 USD */
  units_per_usd: number
  /** publisher's value date, YYYY-MM-DD */
  rate_date: string
  source: string
  /** published by the issuing or a regional central bank */
  official: boolean
}

export interface FxSourceResult {
  source: string
  observations: FxObservation[]
  error?: string
}

const SETTLEMENT_CURRENCIES: readonly CurrencyCode[] = ['KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'BIF']

const positive = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

const iso = (y: number, m: number, d: number): string | null => {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return dt.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// CBK: {data: [["19/03/2026","US DOLLAR","129.5200"], ["19/03/2026","KES / USHS","29.0900"], ...]}
// "KES / USHS" is Uganda shillings per 1 KES, so UGX per USD = KES per USD x it.
// ---------------------------------------------------------------------------
const CBK_CROSS: Readonly<Record<string, CurrencyCode>> = {
  'KES / USHS': 'UGX',
  'KES / TSHS': 'TZS',
  'KES / RWF': 'RWF',
  'KES / BIF': 'BIF',
}

const cbkDate = (s: unknown): string | null => {
  const m = typeof s === 'string' ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s) : null
  return m ? iso(Number(m[3]), Number(m[2]), Number(m[1])) : null
}

export function parseCbk(json: unknown): FxObservation[] {
  const rows = (json as { data?: unknown })?.data
  if (!Array.isArray(rows)) return []
  const byDate = new Map<string, Map<string, number>>()
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 3) continue
    const date = cbkDate(r[0])
    const value = positive(r[2])
    if (!date || value == null || typeof r[1] !== 'string') continue
    if (!byDate.has(date)) byDate.set(date, new Map())
    byDate.get(date)!.set(r[1].trim(), value)
  }
  // latest date that carries the US DOLLAR row
  const dates = [...byDate.keys()].filter((d) => byDate.get(d)!.has('US DOLLAR')).sort()
  const date = dates[dates.length - 1]
  if (!date) return []
  const row = byDate.get(date)!
  const kesPerUsd = row.get('US DOLLAR')!
  const out: FxObservation[] = [{ currency: 'KES', units_per_usd: kesPerUsd, rate_date: date, source: 'cbk', official: true }]
  for (const [label, currency] of Object.entries(CBK_CROSS)) {
    const perKes = row.get(label)
    if (perKes != null) out.push({ currency, units_per_usd: kesPerUsd * perKes, rate_date: date, source: 'cbk-cross', official: true })
  }
  return out
}

// ---------------------------------------------------------------------------
// BNR (Rwanda): [{"currency_name":"USD","average_rate":"1463.3525","post_date":"22-May-26"}, ...] (unordered)
// ---------------------------------------------------------------------------
const MONTHS: Readonly<Record<string, number>> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
}

const bnrDate = (s: unknown): string | null => {
  const m = typeof s === 'string' ? /^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/.exec(s) : null
  const mon = m ? MONTHS[m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()] : undefined
  return m && mon ? iso(2000 + Number(m[3]), mon, Number(m[1])) : null
}

export function parseBnrRw(json: unknown): FxObservation[] {
  if (!Array.isArray(json)) return []
  let best: FxObservation | null = null
  for (const r of json as Array<Record<string, unknown>>) {
    if (r?.currency_name !== 'USD') continue
    const date = bnrDate(r.post_date)
    const value = positive(r.average_rate)
    if (!date || value == null) continue
    if (!best || date > best.rate_date) best = { currency: 'RWF', units_per_usd: value, rate_date: date, source: 'bnr', official: true }
  }
  return best ? [best] : []
}

// ---------------------------------------------------------------------------
// NBE (Ethiopia): {data: [{currency: {code: "USD"}, weighted_average: "157.227", date: "2026-05-18"}, ...]}
// ---------------------------------------------------------------------------
export function parseNbe(json: unknown): FxObservation[] {
  const rows = (json as { data?: unknown })?.data
  if (!Array.isArray(rows)) return []
  for (const r of rows as Array<Record<string, unknown>>) {
    if ((r?.currency as { code?: unknown } | undefined)?.code !== 'USD') continue
    const value = positive(r.weighted_average)
    const m = typeof r.date === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(r.date) : null
    const date = m ? iso(Number(m[1]), Number(m[2]), Number(m[3])) : null
    if (value != null && date) return [{ currency: 'ETB', units_per_usd: value, rate_date: date, source: 'nbe', official: true }]
  }
  return []
}

// ---------------------------------------------------------------------------
// fawazahmed0 currency-api: {"date":"2026-09-26","usd":{"kes":129.57999255, ...}}
// ---------------------------------------------------------------------------
export function parseFawazahmed0(json: unknown): FxObservation[] {
  const j = json as { date?: unknown; usd?: Record<string, unknown> }
  const m = typeof j?.date === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(j.date) : null
  const date = m ? iso(Number(m[1]), Number(m[2]), Number(m[3])) : null
  if (!date || !j.usd || typeof j.usd !== 'object') return []
  const out: FxObservation[] = []
  for (const c of SETTLEMENT_CURRENCIES) {
    const value = positive(j.usd[c.toLowerCase()])
    if (value != null) out.push({ currency: c, units_per_usd: value, rate_date: date, source: 'fawazahmed0', official: false })
  }
  return out
}

// ---------------------------------------------------------------------------
// Fetchers (network). Endpoints: 14-FX-SOURCES.md §2-3. Each is bounded by a
// timeout and never throws; a failed source just contributes nothing.
// ---------------------------------------------------------------------------
const TIMEOUT_MS = 15_000
// CBK's table endpoint returns its whole history (11,000+ rows, ~0.5 MB): it
// timed out at 15 s in production (run 36252161329), so it gets longer.
const CBK_TIMEOUT_MS = 60_000

async function getJson(url: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

const ymd = (d: Date) => d.toISOString().slice(0, 10)
const daysAgo = (now: Date, n: number) => new Date(now.getTime() - n * 86_400_000)

async function attempt(source: string, run: () => Promise<FxObservation[]>): Promise<FxSourceResult> {
  try {
    return { source, observations: await run() }
  } catch (e) {
    return { source, observations: [], error: e instanceof Error ? e.message : 'failed' }
  }
}

export function fetchCbk(): Promise<FxSourceResult> {
  return attempt('cbk', async () =>
    parseCbk(await getJson('https://www.centralbank.go.ke/wp-admin/admin-ajax.php?action=get_wdtable&table_id=193', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'draw=1&start=0&length=-1',
    }, CBK_TIMEOUT_MS)))
}

export function fetchBnrRw(now = new Date()): Promise<FxSourceResult> {
  const url = `https://fxrates.bnr.rw/currency_history/?currency_name=USD&start_date=${ymd(daysAgo(now, 10))}&end_date=${ymd(now)}`
  return attempt('bnr', async () => parseBnrRw(await getJson(url)))
}

/** NBE publishes on business days: walk back up to 6 days to the latest one. */
export function fetchNbe(now = new Date()): Promise<FxSourceResult> {
  return attempt('nbe', async () => {
    for (let i = 0; i <= 6; i++) {
      const obs = parseNbe(await getJson(`https://api.nbe.gov.et/api/filter-exchange-rates?date=${ymd(daysAgo(now, i))}`))
      if (obs.length) return obs
    }
    return []
  })
}

/** jsDelivr first, the project's Cloudflare mirror second. */
export function fetchFawazahmed0(): Promise<FxSourceResult> {
  return attempt('fawazahmed0', async () => {
    for (const url of [
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
      'https://latest.currency-api.pages.dev/v1/currencies/usd.json',
    ]) {
      try {
        const obs = parseFawazahmed0(await getJson(url))
        if (obs.length) return obs
      } catch {
        // try the mirror
      }
    }
    throw new Error('all mirrors failed')
  })
}

/** All sources in parallel. */
export async function fetchFxObservations(now = new Date()): Promise<FxSourceResult[]> {
  return Promise.all([fetchCbk(), fetchBnrRw(now), fetchNbe(now), fetchFawazahmed0()])
}
