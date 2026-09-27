// lib/__tests__/market-history.test.ts
// Locks the two properties charts depend on: complete newest-anchored history
// past PostgREST's 1,000-row cap, and recency thinning that never drops the
// latest point and respects each tier's cap.
import { describe, it, expect } from 'vitest'
import { fetchMarketHistory, thinByRecency, RECENCY_TIERS, PAGE_SIZE } from '@/lib/markets/history'
import { makeClient } from './helpers/fake-supabase'

const HOUR = 3_600_000
const at = (i: number) => new Date(Date.parse('2026-01-01T00:00:00Z') + i * HOUR).toISOString()

describe('fetchMarketHistory', () => {
  it('pages past the 1,000-row cap and returns rows oldest first', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ market_id: 'm', market_option_id: null, recorded_at: at(i) }))
    const got = await fetchMarketHistory<{ recorded_at: string }>(makeClient({ price_history: rows }), 'm', { select: '*' })
    expect(got).toHaveLength(2500)
    expect(got[0].recorded_at).toBe(at(0))
    expect(got.at(-1)!.recorded_at).toBe(at(2499))
  })

  it('drops the oldest rows, never the newest, when maxRows is reached', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ market_id: 'm', market_option_id: null, recorded_at: at(i) }))
    const got = await fetchMarketHistory<{ recorded_at: string }>(makeClient({ price_history: rows }), 'm', { select: '*', maxRows: PAGE_SIZE })
    expect(got).toHaveLength(PAGE_SIZE)
    expect(got.at(-1)!.recorded_at).toBe(at(2499))
  })

  it('scopes market-level vs per-option rows', async () => {
    const rows = [
      { market_id: 'm', market_option_id: null, recorded_at: at(0) },
      { market_id: 'm', market_option_id: 'o1', recorded_at: at(1) },
      { market_id: 'x', market_option_id: null, recorded_at: at(2) },
    ]
    const client = makeClient({ price_history: rows })
    expect(await fetchMarketHistory(client, 'm', { select: '*', scope: 'market' })).toHaveLength(1)
    expect(await fetchMarketHistory(client, 'm', { select: '*', scope: 'options' })).toHaveLength(1)
    expect(await fetchMarketHistory(client, 'm', { select: '*' })).toHaveLength(2)
  })
})

describe('thinByRecency', () => {
  const series = (n: number, stepMs: number) => Array.from({ length: n }, (_, i) => ({ t: new Date(i * stepMs).toISOString() }))

  it('keeps the latest point and stays chronological', () => {
    const rows = series(5000, 10 * 60_000) // ~35 days at 10-minute spacing
    const out = thinByRecency(rows, (r) => r.t)
    expect(out.at(-1)).toBe(rows.at(-1))
    for (let i = 1; i < out.length; i++) expect(out[i].t >= out[i - 1].t).toBe(true)
  })

  it('respects every tier cap', () => {
    const out = thinByRecency(series(5000, 10 * 60_000), (r) => r.t)
    const max = RECENCY_TIERS.reduce((n, t) => n + t.max, 0)
    expect(out.length).toBeLessThanOrEqual(max)
  })

  it('returns short series unchanged', () => {
    const rows = series(10, HOUR)
    expect(thinByRecency(rows, (r) => r.t)).toEqual(rows)
  })
})
