import { describe, it, expect, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// Audit 6.15: the query took the OLDEST `limit` rows (ascending + limit), so a
// market with more history than the limit showed a chart that ended long ago.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
import { GET } from '@/app/api/markets/[id]/price-history/route'
import { createClient } from '@/lib/supabase/server'

const MID = '11111111-1111-4111-8111-111111111111'
// 10 rows, t=0..9; the table (and a correct query) returns the newest `limit` first
const ALL = Array.from({ length: 10 }, (_, i) => ({ yes_price: i / 10, no_price: 1 - i / 10, volume_usd: 0, recorded_at: `2026-09-2${i}T00:00:00Z` }))

describe('GET /api/markets/[id]/price-history', () => {
  it('returns the LATEST points, oldest first', async () => {
    let ascending: boolean | undefined
    let lim = 0
    const b: Record<string, unknown> = {}
    b.select = () => b; b.eq = () => b; b.gte = () => b; b.lte = () => b
    b.order = (_c: string, o: { ascending: boolean }) => { ascending = o.ascending; return b }
    b.limit = (n: number) => { lim = n; return b }
    b.then = (res: (v: unknown) => void) => {
      const sorted = [...ALL].sort((x, y) => (ascending ? 1 : -1) * x.recorded_at.localeCompare(y.recorded_at))
      return res({ data: sorted.slice(0, lim), error: null })
    }
    ;(createClient as unknown as Mock).mockResolvedValue({ from: () => b })
    const res = await GET(new Request(`https://x/api/markets/${MID}/price-history?limit=3`) as unknown as NextRequest,
      { params: Promise.resolve({ id: MID }) } as never)
    const body = await res.json()
    expect(body.data.map((p: { recorded_at: string }) => p.recorded_at)).toEqual([
      '2026-09-27T00:00:00Z', '2026-09-28T00:00:00Z', '2026-09-29T00:00:00Z',
    ])
  })
})
