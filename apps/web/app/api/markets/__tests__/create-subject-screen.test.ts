import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// L.N. 112 of 2026 Reg. 45(7): a market the subject screen flags never goes
// live directly, even when staff create it; the flags are stored for review.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }))
vi.mock('@/lib/platform-gate', () => ({ platformGate: vi.fn(async () => ({ ok: true })) }))
import { POST } from '@/app/api/markets/route'
import { createClient, createAdminClient } from '@/lib/supabase/server'

let inserted: Record<string, unknown> | null
beforeEach(() => {
  inserted = null
  ;(createClient as unknown as Mock).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'staff-1' } }, error: null }) },
    rpc: () => ({ maybeSingle: async () => ({ data: { account_status: 'active', role: 'admin' }, error: null }) }),
  })
  const b: Record<string, unknown> = {}
  b.insert = (row: Record<string, unknown>) => { inserted = row; return b }
  b.select = () => b
  b.single = async () => ({ data: { id: 'm-new', ...inserted }, error: null })
  ;(createAdminClient as unknown as Mock).mockResolvedValue({ from: () => b })
})

const create = (over: Record<string, unknown>) =>
  POST(new Request('https://x/api/markets', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Kenyan wins 2026 Berlin Marathon?',
      description: 'Kenya has long dominated the majors; Berlin is a favourite for world records.',
      category: 'sports',
      resolution_criteria: "Resolves YES if a Kenyan-passport athlete wins the elite men's or women's race.",
      closes_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      ...over,
    }),
  }) as unknown as NextRequest)

describe('POST /api/markets subject screen', () => {
  it('lets staff publish an unflagged market directly', async () => {
    const res = await create({})
    expect(res.status).toBe(201)
    expect(inserted?.status).toBe('active')
  })

  it('holds a flagged staff-created market for review and records the flags', async () => {
    const res = await create({
      title: 'Gachagua impeachment upheld on appeal?',
      description: "Gachagua's team has appealed the High Court decision that confirmed his removal.",
      category: 'politics',
      resolution_criteria: 'Resolves YES if the appellate courts uphold the impeachment in a final ruling.',
    })
    expect(res.status).toBe(201)
    expect(inserted?.status).toBe('pending')
    const screen = (inserted?.metadata as { subject_screen: { flags: Array<{ category: string }> } }).subject_screen
    expect(screen.flags.map((f) => f.category)).toContain('court_proceedings')
  })
})
