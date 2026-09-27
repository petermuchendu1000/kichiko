// lib/__tests__/eligibility.test.ts — per-country minimum gambling age.
import { describe, it, expect } from 'vitest'
import { MINIMUM_AGE, minimumAge, ageOn, isOldEnough } from '@/lib/eligibility'

const on = (s: string) => new Date(`${s}T00:00:00Z`)

describe('minimum gambling age', () => {
  it('is 25 in Uganda and 18 in Kenya, Tanzania and Rwanda', () => {
    expect(MINIMUM_AGE).toEqual({ KE: 18, UG: 25, TZ: 18, RW: 18 })
  })
  it('applies the strictest known rule to an unknown country', () => {
    expect(minimumAge(null)).toBe(25)
    expect(minimumAge('ZZ')).toBe(25)
    expect(minimumAge('ug')).toBe(25)
  })
  it('counts birthdays exactly', () => {
    expect(ageOn(on('2001-09-28'), on('2026-09-27'))).toBe(24)
    expect(ageOn(on('2001-09-27'), on('2026-09-27'))).toBe(25)
  })
  it('a 24-year-old may play in Kenya but not in Uganda', () => {
    const dob = on('2002-01-01'), now = on('2026-09-27')
    expect(isOldEnough(dob, 'KE', now)).toBe(true)
    expect(isOldEnough(dob, 'UG', now)).toBe(false)
  })
})
