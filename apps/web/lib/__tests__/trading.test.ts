import { describe, it, expect } from 'vitest'
import {
  orderTarget,
  optionsResolverRpc,
  clampLimitCents,
  oppositeSide,
  limitSharesForAmount,
} from '@/lib/trading'

describe('orderTarget — Phase C ticket → /api/orders body shaping', () => {
  it('binary market sends the side only (no option id)', () => {
    expect(orderTarget({ isMulti: false, independent: false, side: 'yes' })).toEqual({ side: 'yes' })
    expect(orderTarget({ isMulti: false, independent: false, optionId: 'ignored', side: 'no' })).toEqual({ side: 'no' })
  })

  it('simplex multiple_choice sends the option id only (no side)', () => {
    expect(orderTarget({ isMulti: true, independent: false, optionId: 'A', side: 'yes' })).toEqual({
      market_option_id: 'A',
    })
  })

  it('independent multiple_choice sends BOTH option id and side (per-candidate Yes/No)', () => {
    expect(orderTarget({ isMulti: true, independent: true, optionId: 'A', side: 'no' })).toEqual({
      market_option_id: 'A',
      side: 'no',
    })
  })

  it('never emits an independent option order without a side (API rejects that with 400)', () => {
    const body = orderTarget({ isMulti: true, independent: true, optionId: 'A', side: 'yes' })
    expect('market_option_id' in body && 'side' in body).toBe(true)
  })

  it('throws if a multiple_choice order is missing its option id', () => {
    expect(() => orderTarget({ isMulti: true, independent: true, side: 'yes' })).toThrow(/optionId/)
    expect(() => orderTarget({ isMulti: true, independent: false, optionId: null, side: 'yes' })).toThrow(/optionId/)
  })
})

describe('optionsResolverRpc — settlement dispatch by pricing engine', () => {
  it('simplex → resolve_market_options (app path)', () => {
    expect(optionsResolverRpc('simplex')).toBe('resolve_market_options')
    expect(optionsResolverRpc(null)).toBe('resolve_market_options')
    expect(optionsResolverRpc(undefined)).toBe('resolve_market_options')
  })
  it('independent → resolve_market_options_binary (app path)', () => {
    expect(optionsResolverRpc('independent')).toBe('resolve_market_options_binary')
  })
  it('simplex → admin_resolve_market_options (admin path)', () => {
    expect(optionsResolverRpc('simplex', true)).toBe('admin_resolve_market_options')
    expect(optionsResolverRpc(null, true)).toBe('admin_resolve_market_options')
  })
  it('independent → admin_resolve_market_options_binary (admin path)', () => {
    expect(optionsResolverRpc('independent', true)).toBe('admin_resolve_market_options_binary')
  })
  it('unknown mode is treated as simplex (safe default)', () => {
    expect(optionsResolverRpc('weird')).toBe('resolve_market_options')
    expect(optionsResolverRpc('weird', true)).toBe('admin_resolve_market_options')
  })
})

describe('clampLimitCents — Polymarket limit-price − / + stepper band', () => {
  it('clamps into 0..99 and rounds', () => {
    expect(clampLimitCents(50)).toBe(50)
    expect(clampLimitCents(-1)).toBe(0)
    expect(clampLimitCents(0)).toBe(0)
    expect(clampLimitCents(99)).toBe(99)
    expect(clampLimitCents(100)).toBe(99)
    expect(clampLimitCents(38.4)).toBe(38)
    expect(clampLimitCents(38.6)).toBe(39)
  })
  it('is fail-safe for non-finite input', () => {
    expect(clampLimitCents(NaN)).toBe(0)
    expect(clampLimitCents(Infinity)).toBe(0)
    expect(clampLimitCents(-Infinity)).toBe(0)
  })
  it('composes as a ±1 stepper', () => {
    expect(clampLimitCents(0 - 1)).toBe(0)   // decrement floor
    expect(clampLimitCents(98 + 1)).toBe(99) // increment
    expect(clampLimitCents(99 + 1)).toBe(99) // increment ceiling
  })
})

describe('oppositeSide — ticket ⇄ swap affordance', () => {
  it('flips yes/no', () => {
    expect(oppositeSide('yes')).toBe('no')
    expect(oppositeSide('no')).toBe('yes')
  })
  it('is an involution (double-swap returns original)', () => {
    expect(oppositeSide(oppositeSide('yes'))).toBe('yes')
    expect(oppositeSide(oppositeSide('no'))).toBe('no')
  })
})

describe('limitSharesForAmount', () => {
  // 46% of $1 at 129.62 KES/USD
  const per = 0.46 * 129.62
  it('buys the most whole cents of a share the amount covers, never more', () => {
    const n = limitSharesForAmount(50, per, 20)
    expect(n).toBe(0.83)
    expect(n * per).toBeLessThanOrEqual(50)
  })
  it('rounds up just enough to meet the minimum when the amount meets it', () => {
    const n = limitSharesForAmount(20, per, 20)
    expect(n * per).toBeGreaterThanOrEqual(20)
    expect((n - 0.01) * per).toBeLessThan(20)
  })
  it('leaves an amount below the minimum below it (the ticket shows the minimum notice)', () => {
    expect(limitSharesForAmount(15, per, 20) * per).toBeLessThan(20)
  })
  it('is zero without an amount or a price', () => {
    expect(limitSharesForAmount(0, per, 20)).toBe(0)
    expect(limitSharesForAmount(50, 0, 20)).toBe(0)
  })
})
