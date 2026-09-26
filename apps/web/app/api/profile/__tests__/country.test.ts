import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// Settlement currency = the currency of the user's country (migration 079).
// The country changes only through set_my_country (POST /api/profile/country);
// PATCH /api/profile no longer accepts country_code / preferred_currency.
vi.mock('@/lib/auth', () => ({ requireUser: vi.fn() }))

import { PATCH } from '@/app/api/profile/route'
import { POST as COUNTRY } from '@/app/api/profile/country/route'
import { requireUser } from '@/lib/auth'

const guard = requireUser as unknown as Mock
const rpc = vi.fn()
const update = vi.fn()

const req = (url: string, body: unknown) =>
  new Request(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) as unknown as NextRequest

beforeEach(() => {
  vi.clearAllMocks()
  update.mockReturnValue({ eq: async () => ({ error: null }) })
  rpc.mockImplementation((name: string) => {
    if (name === 'get_my_profile') return { maybeSingle: async () => ({ data: { id: 'u1' }, error: null }) }
    return Promise.resolve({ data: { country: 'UG', currency: 'UGX', changed: true }, error: null })
  })
  guard.mockResolvedValue({ ok: true, ctx: { user: { id: 'u1', email: 'a@b.c' }, supabase: { rpc, from: () => ({ update }) } } })
})

describe('PATCH /api/profile', () => {
  it('refuses country_code and preferred_currency (400) and writes nothing', async () => {
    for (const body of [{ country_code: 'UG' }, { preferred_currency: 'UGX' }, { display_name: 'x', country_code: 'KE' }]) {
      const res = await PATCH(req('https://x/api/profile', body))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/country/i)
    }
    expect(update).not.toHaveBeenCalled()
  })
  it('still updates the editable fields', async () => {
    const res = await PATCH(req('https://x/api/profile', { display_name: 'Amina' }))
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith({ display_name: 'Amina' })
  })
})

describe('POST /api/profile/country', () => {
  it('calls set_my_country with the country, signals and source', async () => {
    const res = await COUNTRY(req('https://x/api/profile/country', { country: 'ug', source: 'browser', signals: { tz: 'Africa/Kampala' } }))
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('set_my_country', { p_country: 'UG', p_signals: { tz: 'Africa/Kampala' }, p_source: 'browser' })
    expect(await res.json()).toMatchObject({ success: true, country: 'UG', currency: 'UGX' })
  })
  it('rejects an unsupported country before calling the database', async () => {
    const res = await COUNTRY(req('https://x/api/profile/country', { country: 'DE' }))
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  const cases: Array<[string, number]> = [['P0170', 409], ['P0171', 400], ['P0172', 409], ['P0173', 429], ['P0174', 401]]
  for (const [code, status] of cases) {
    it(`maps ${code} to ${status}`, async () => {
      rpc.mockResolvedValueOnce({ data: null, error: { code, message: 'x' } })
      const res = await COUNTRY(req('https://x/api/profile/country', { country: 'KE' }))
      expect(res.status).toBe(status)
    })
  }
  it('passes the auth guard response through', async () => {
    guard.mockResolvedValueOnce({ ok: false, response: new Response('{}', { status: 401 }) })
    const res = await COUNTRY(req('https://x/api/profile/country', { country: 'KE' }))
    expect(res.status).toBe(401)
  })
})
