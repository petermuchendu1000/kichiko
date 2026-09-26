import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// Void policy (migration 072) at the route: the 'void' action maps to
// admin_void_market with a default YES price of 0.5, validates input, and a
// cancel that hits P0144 (open positions) is answered 409 with a void hint.
vi.mock('@/lib/auth', () => ({ requireCapability: vi.fn() }))
import { POST } from '@/app/api/admin/markets/[id]/action/route'
import { requireCapability } from '@/lib/auth'

const guard = requireCapability as unknown as Mock
const rpc = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  guard.mockResolvedValue({ ok: true, ctx: { supabase: { rpc } } })
  rpc.mockResolvedValue({ data: { success: true }, error: null })
})

const call = (body: unknown) =>
  POST(new Request('https://x/api/admin/markets/m1/action', { method: 'POST', body: JSON.stringify(body) }) as unknown as NextRequest,
       { params: Promise.resolve({ id: 'm1' }) })

describe("admin market action 'void'", () => {
  it('requires the markets:cancel capability', async () => {
    await call({ action: 'void', reason: 'event cancelled by organiser' })
    expect(guard).toHaveBeenCalledWith('markets:cancel')
  })
  it('defaults the YES price to 0.5', async () => {
    const res = await call({ action: 'void', reason: 'event cancelled by organiser' })
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('admin_void_market', { p_market_id: 'm1', p_reason: 'event cancelled by organiser', p_yes_price: 0.5 })
  })
  it('passes an explicit YES price through', async () => {
    await call({ action: 'void', reason: 'resolution source discontinued', yes_price: 0.3 })
    expect(rpc).toHaveBeenCalledWith('admin_void_market', { p_market_id: 'm1', p_reason: 'resolution source discontinued', p_yes_price: 0.3 })
  })
  it.each([[{ yes_price: 1.2 }], [{ yes_price: -0.1 }], [{ reason: 'short' }]])('rejects invalid input %j with 400 and no RPC', async (over) => {
    const res = await call({ action: 'void', reason: 'event cancelled by organiser', ...over })
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('answers a cancel blocked by open positions (P0144) with 409 and a void hint', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0144', message: 'Market has open positions' } })
    const res = await call({ action: 'cancel', reason: 'no longer relevant' })
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.code).toBe('P0144')
    expect(json.hint).toMatch(/void/)
  })
})
