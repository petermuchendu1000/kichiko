// lib/__tests__/banned-subjects.test.ts
// The Reg. 45(7) screen on real market text from production (2026-09-27).
import { describe, it, expect } from 'vitest'
import { screenMarketSubject, describeFlags } from '@/lib/markets/banned-subjects'

describe('screenMarketSubject', () => {
  it('flags the market on a pending court appeal (hidden 2026-09-27)', () => {
    const flags = screenMarketSubject({
      title: 'Gachagua impeachment upheld on appeal?',
      description: "Gachagua's team has appealed the High Court decision that confirmed his removal as Deputy President.",
      resolution_criteria: 'Resolves YES if the appellate courts uphold the impeachment (removal stands) in a final ruling.',
    })
    expect(flags.map((f) => f.category)).toContain('court_proceedings')
    expect(describeFlags(flags)).toMatch(/proceedings pending before a court in Kenya/)
  })

  it.each([
    ['Kenyan wins 2026 Berlin Marathon?', "Resolves YES if a Kenyan-passport athlete wins the elite men's or women's race at the 2026 Berlin Marathon."],
    ['CBK cuts base rate below 9% in 2026?', 'Resolves YES if the CBK Central Bank Rate is set below 9.00% at any MPC meeting in 2026.'],
    ['BTC above $75K in 2026?', 'Resolves YES if Bitcoin trades above 75,000 USD on a major exchange.'],
  ])('does not flag %s', (title, resolution_criteria) => {
    expect(screenMarketSubject({ title, resolution_criteria })).toEqual([])
  })

  it('covers the other two categories and Kiswahili terms', () => {
    expect(screenMarketSubject({ title: 'Will the minister be hospitalised this year?' })[0].category).toBe('person_safety_health_death')
    expect(screenMarketSubject({ title: 'Maandamano jijini Nairobi mwezi huu?' })[0].category).toBe('security_public_order')
    expect(screenMarketSubject({ title: 'Mahakama itaamua kesi hii?' })[0].category).toBe('court_proceedings')
  })
})
