import { describe, it, expect } from 'vitest'
import { planFunding } from '@/lib/funding'

describe('planFunding', () => {
  it('is funded when balance covers the stake', () => {
    expect(planFunding(1000, 500)).toEqual({ funded: true, shortfall: 0 })
    expect(planFunding(500, 500)).toEqual({ funded: true, shortfall: 0 })
  })

  it('reports the exact shortfall, rounded up, when underfunded', () => {
    expect(planFunding(200, 500)).toEqual({ funded: false, shortfall: 300 })
    expect(planFunding(199.2, 500)).toEqual({ funded: false, shortfall: 301 })
    expect(planFunding(0, 129)).toEqual({ funded: false, shortfall: 129 })
  })

  it('treats a zero / absent stake as trivially funded', () => {
    expect(planFunding(0, 0)).toEqual({ funded: true, shortfall: 0 })
    expect(planFunding(50, 0)).toEqual({ funded: true, shortfall: 0 })
  })

  it('floors bad inputs to 0 (never negative shortfall, never false funded)', () => {
    expect(planFunding(Number.NaN, 100)).toEqual({ funded: false, shortfall: 100 })
    expect(planFunding(-50, 100)).toEqual({ funded: false, shortfall: 100 })
    expect(planFunding(100, Number.POSITIVE_INFINITY)).toEqual({ funded: true, shortfall: 0 })
    expect(planFunding(100, -10)).toEqual({ funded: true, shortfall: 0 })
  })
})
