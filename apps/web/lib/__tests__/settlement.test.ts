import { describe, it, expect, vi } from 'vitest'
import { getSettlement, resolveMoneyCurrency, type Settlement } from '@/lib/settlement'

const UG: Settlement = { country: 'UG', currency: 'UGX', walletId: 'w1', locked: true }

describe('resolveMoneyCurrency', () => {
  it('uses the settlement currency when the client sends none', () => {
    expect(resolveMoneyCurrency(UG)).toEqual({ ok: true, currency: 'UGX', country: 'UG' })
  })
  it('accepts a matching assertion', () => {
    expect(resolveMoneyCurrency(UG, 'UGX')).toMatchObject({ ok: true, currency: 'UGX' })
  })
  it('409 currency_mismatch when the client asserts another currency', () => {
    expect(resolveMoneyCurrency(UG, 'KES')).toMatchObject({ ok: false, status: 409, code: 'currency_mismatch' })
  })
  it('409 country_required without a supported country (never a KES default)', () => {
    expect(resolveMoneyCurrency({ country: null, currency: null, walletId: null, locked: false }, 'KES'))
      .toMatchObject({ ok: false, status: 409, code: 'country_required' })
    expect(resolveMoneyCurrency(null)).toMatchObject({ ok: false, code: 'country_required' })
  })
})

describe('getSettlement', () => {
  it('maps the user_settlement row', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ country: 'UG', currency: 'UGX', wallet_id: 'w1', locked: true }], error: null })
    expect(await getSettlement({ rpc } as never, 'u1')).toEqual(UG)
    expect(rpc).toHaveBeenCalledWith('user_settlement', { p_user: 'u1' })
  })
  it('null on error or no row', async () => {
    expect(await getSettlement({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'x' } }) } as never, 'u1')).toBeNull()
    expect(await getSettlement({ rpc: vi.fn().mockResolvedValue({ data: [], error: null }) } as never, 'u1')).toBeNull()
  })
})
