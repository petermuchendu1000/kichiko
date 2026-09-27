import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// L.N. 112 of 2026 Reg. 45(7) at the approval gate: every approval carries the
// reviewer's attestation into the audited reason, and a market the subject
// screen flags cannot be approved without a written reason.
vi.mock('@/lib/auth', () => ({ requireCapability: vi.fn() }))
import { POST } from '@/app/api/admin/markets/[id]/action/route'
import { requireCapability } from '@/lib/auth'

const guard = requireCapability as unknown as Mock
const rpc = vi.fn()
let row: Record<string, string> = {}
const from = () => {
  const b: Record<string, unknown> = {}
  b.select = () => b
  b.eq = () => b
  b.single = async () => ({ data: row, error: null })
  return b
}
beforeEach(() => {
  vi.clearAllMocks()
  guard.mockResolvedValue({ ok: true, ctx: { supabase: { rpc, from } } })
  rpc.mockResolvedValue({ data: { success: true }, error: null })
  row = { title: 'Kenyan wins 2026 Berlin Marathon?', description: 'Kenya has long dominated the majors.', resolution_criteria: '' }
})

const call = (body: unknown) =>
  POST(new Request('https://x/api/admin/markets/m1/action', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest,
       { params: Promise.resolve({ id: 'm1' }) })

describe("admin market action 'approve' (Reg. 45(7))", () => {
  it('refuses an approval without the attestation', async () => {
    const res = await call({ action: 'approve' })
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('writes the attestation into the audited reason', async () => {
    const res = await call({ action: 'approve', attest_permitted_subject: true })
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('admin_approve_market', { p_market_id: 'm1', p_reason: '[Reg. 45(7) attested]' })
  })

  it('requires a reason for a flagged market, then records the flag', async () => {
    row = {
      title: 'Gachagua impeachment upheld on appeal?',
      description: "Gachagua's team has appealed the High Court decision that confirmed his removal as Deputy President.",
      resolution_criteria: 'Resolves YES if the appellate courts uphold the impeachment (removal stands) in a final ruling.',
    }
    const refused = await call({ action: 'approve', attest_permitted_subject: true })
    expect(refused.status).toBe(400)
    expect((await refused.json()).code).toBe('subject_review_required')
    expect(rpc).not.toHaveBeenCalled()

    const ok = await call({ action: 'approve', attest_permitted_subject: true, reason: 'Counsel confirmed the appeal was decided on 1 Oct.' })
    expect(ok.status).toBe(200)
    expect(rpc.mock.calls[0][1].p_reason).toBe('[Reg. 45(7) attested; flagged: court_proceedings] Counsel confirmed the appeal was decided on 1 Oct.')
  })
})
