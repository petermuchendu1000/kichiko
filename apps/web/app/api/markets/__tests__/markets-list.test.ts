import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// Audit 6.35: GET /api/markets passed sort_by straight to .order() (any column,
// and the documented aliases 'volume'/'bettors' are not columns: a 500) and
// did not validate page/per_page (NaN or negative offsets: a 500).
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }))
import { GET } from '@/app/api/markets/route'
import { createClient } from '@/lib/supabase/server'

type Call = { order?: [string, boolean]; range?: [number, number]; statuses?: string[]; eqs: [string, unknown][] }
let call: Call

beforeEach(() => {
  call = { eqs: [] }
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.in = (_c: string, v: string[]) => { call.statuses = v; return b }
  b.eq = (c: string, v: unknown) => { call.eqs.push([c, v]); return b }
  b.textSearch = () => b
  b.order = (c: string, o: { ascending: boolean }) => { call.order = [c, o.ascending]; return b }
  b.range = (a: number, z: number) => { call.range = [a, z]; return b }
  b.then = (res: (v: unknown) => void) => res({ data: [], count: 0, error: null })
  ;(createClient as unknown as Mock).mockResolvedValue({ from: () => b })
})

const get = (qs: string) => GET(new Request(`https://x/api/markets?${qs}`) as unknown as NextRequest)

describe('GET /api/markets parameter validation', () => {
  it('maps the documented sort aliases to columns', async () => {
    await get('sort_by=volume'); expect(call.order).toEqual(['total_volume_usd', false])
    await get('sort_by=bettors&sort_order=asc'); expect(call.order).toEqual(['unique_bettors', true])
    await get('sort_by=closes_at'); expect(call.order?.[0]).toBe('closes_at')
  })
  it('ignores a column that is not a sort option', async () => {
    await get('sort_by=creator_id'); expect(call.order?.[0]).toBe('total_volume_usd')
    await get('sort_by=title;drop'); expect(call.order?.[0]).toBe('total_volume_usd')
    await get('sort_by=constructor'); expect(call.order?.[0]).toBe('total_volume_usd')
    await get('sort_by=__proto__'); expect(call.order?.[0]).toBe('total_volume_usd')
  })
  it('clamps page and per_page', async () => {
    const r1 = await get('page=abc&per_page=xyz'); expect(r1.status).toBe(200); expect(call.range).toEqual([0, 19])
    await get('page=-3&per_page=0'); expect(call.range).toEqual([0, 0])
    await get('page=2&per_page=1000'); expect(call.range).toEqual([100, 199])
  })
  it('keeps status and category to known values', async () => {
    await get('status=bogus&category=nope'); expect(call.statuses).toEqual(['active']); expect(call.eqs.some(([c]) => c === 'category')).toBe(false)
    await get('status=all&category=sports'); expect(call.statuses).toEqual(['active', 'closed', 'resolved']); expect(call.eqs).toContainEqual(['category', 'sports'])
  })
})
