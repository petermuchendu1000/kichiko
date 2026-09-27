// lib/__tests__/stake.test.ts
// Legal minimum stake (Gambling Control Act 2025 s.71(1): KSh 20) and the
// set-to quick amounts that replaced converted US-dollar presets.
import { describe, it, expect } from 'vitest'
import { MIN_STAKE_KES, QUICK_AMOUNTS_KES, niceCeil, minStakeLocal, quickAmounts, stakeError } from '@/lib/stake'

const RATES = { KES: 1 / 129.6, UGX: 1 / 3700 } // USD per 1 unit of local currency

describe('stake rules', () => {
  it('uses the statutory minimum of KSh 20', () => {
    expect(MIN_STAKE_KES).toBe(20)
    expect(minStakeLocal('KES', RATES)).toBe(20)
  })

  it('offers KSh 20 / 50 / 100 / 200 with nothing below the minimum and no USD-derived values', () => {
    expect(quickAmounts('KES', RATES)).toEqual([20, 50, 100, 200])
    expect(QUICK_AMOUNTS_KES[0]).toBe(MIN_STAKE_KES)
    expect(quickAmounts('KES', RATES)).not.toContain(130)
  })

  it('converts to other currencies on round 1-2-5 values, never below their minimum', () => {
    const ugx = quickAmounts('UGX', RATES)
    const min = minStakeLocal('UGX', RATES)
    expect(ugx.every((v) => v >= min)).toBe(true)
    expect(ugx.every((v) => [1, 2, 5].includes(Number(String(v)[0])) && /^[125]0*$/.test(String(v)))).toBe(true)
  })

  it('reports amounts under the minimum and accepts the minimum itself', () => {
    expect(stakeError(19, 'KES', 'KSh', RATES)).toBe('The minimum stake is KSh 20.')
    expect(stakeError(20, 'KES', 'KSh', RATES)).toBeNull()
    expect(stakeError(0, 'KES', 'KSh', RATES)).toBeNull() // empty field: no nag
  })

  it('rounds up on a 1-2-5 ladder', () => {
    expect(niceCeil(20)).toBe(20)
    expect(niceCeil(21)).toBe(50)
    expect(niceCeil(571)).toBe(1000)
    expect(niceCeil(0)).toBe(0)
  })
})
