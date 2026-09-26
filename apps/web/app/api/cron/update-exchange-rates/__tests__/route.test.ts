import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// The FX cron sends EVERY observation from every source to the gated
// upsert_fx_observations RPC (migrations 075/076 decide what is accepted).
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/integrations/fx-sources', () => ({ fetchFxObservations: vi.fn() }))

import { GET } from '@/app/api/cron/update-exchange-rates/route'
import { createAdminClient } from '@/lib/supabase/server'
import { fetchFxObservations } from '@/lib/integrations/fx-sources'

const admin = createAdminClient as unknown as Mock
const fetchObs = fetchFxObservations as unknown as Mock
const rpc = vi.fn()

const req = (secret?: string) =>
  new Request('https://x/api/cron/update-exchange-rates', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  }) as unknown as NextRequest

const KES = { currency: 'KES', units_per_usd: 129.52, rate_date: '2026-09-25', source: 'cbk', official: true }
const KES2 = { currency: 'KES', units_per_usd: 129.58, rate_date: '2026-09-26', source: 'fawazahmed0', official: false }
const RWF = { currency: 'RWF', units_per_usd: 1463.35, rate_date: '2026-09-25', source: 'bnr', official: true }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 's3cret'
  rpc.mockImplementation(async (name: string) => {
    if (name === 'upsert_fx_observations') return { data: { accepted: 2, held: 0, rejected: 0, skipped: 0, currencies: {} }, error: null }
    return { data: null, error: null }
  })
  admin.mockResolvedValue({ rpc })
})

describe('GET /api/cron/update-exchange-rates', () => {
  it('rejects a request without the cron secret', async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(fetchObs).not.toHaveBeenCalled()
  })

  it('sends every observation from every source to upsert_fx_observations', async () => {
    fetchObs.mockResolvedValue([
      { source: 'cbk', observations: [KES] },
      { source: 'bnr', observations: [RWF] },
      { source: 'nbe', observations: [], error: 'HTTP 503' },
      { source: 'fawazahmed0', observations: [KES2] },
    ])
    const res = await GET(req('s3cret'))
    expect(res.status).toBe(200)
    const call = rpc.mock.calls.find((c) => c[0] === 'upsert_fx_observations')!
    expect(call[1]).toEqual({ p_obs: [KES, RWF, KES2] })
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, accepted: 2, observations: 3, source_errors: { nbe: 'HTTP 503' } })
    expect(rpc.mock.calls.some((c) => c[0] === 'upsert_exchange_rates')).toBe(false)
  })

  it('no observations at all -> partial run, no write', async () => {
    fetchObs.mockResolvedValue([{ source: 'cbk', observations: [], error: 'timeout' }])
    const res = await GET(req('s3cret'))
    expect(res.status).toBe(200)
    expect(rpc.mock.calls.some((c) => c[0] === 'upsert_fx_observations')).toBe(false)
    expect(await res.json()).toMatchObject({ ok: true, accepted: 0, observations: 0 })
  })

  it('an RPC error fails the run (500)', async () => {
    fetchObs.mockResolvedValue([{ source: 'cbk', observations: [KES] }])
    rpc.mockImplementation(async (name: string) =>
      name === 'upsert_fx_observations' ? { data: null, error: { message: 'boom' } } : { data: null, error: null })
    const res = await GET(req('s3cret'))
    expect(res.status).toBe(500)
  })
})
