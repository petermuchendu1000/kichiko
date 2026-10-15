import { describe, it, expect } from 'vitest'
import { phoneKey, verifiedPhoneKeys, checkWithdrawalDestination } from '../verified-phones'

describe('phoneKey', () => {
  it('treats the same Kenyan number typed any way as one number', () => {
    const forms = ['0712345678', '+254712345678', '254712345678', '+254 712 345 678', '712345678']
    const keys = new Set(forms.map(phoneKey))
    expect(keys.size).toBe(1)
    expect([...keys][0]).toBe('254712345678')
  })

  it('keeps different numbers different', () => {
    expect(phoneKey('0712345678')).not.toBe(phoneKey('0712345679'))
  })

  it('falls back to digits for numbers it cannot place, instead of throwing', () => {
    // Other countries reach this code; a throw here would 500 a withdrawal.
    expect(() => phoneKey('+256772123456')).not.toThrow()
    expect(phoneKey('+256772123456')).toBe('256772123456')
    expect(phoneKey('256 772 123 456')).toBe('256772123456')
  })

  it('returns null rather than a junk key', () => {
    for (const v of [null, undefined, '', '   ', 'not a phone', '12']) {
      expect(phoneKey(v as string)).toBeNull()
    }
  })
})

describe('verifiedPhoneKeys', () => {
  it('collapses repeat deposits from one number, and drops unusable rows', () => {
    const keys = verifiedPhoneKeys(['0712345678', '+254712345678', null, '', '0722000000'])
    expect(keys.size).toBe(2)
    expect(keys.has('254712345678')).toBe(true)
    expect(keys.has('254722000000')).toBe(true)
  })
})

describe('checkWithdrawalDestination', () => {
  const verified = verifiedPhoneKeys(['0712345678'])

  it('allows a number the person has deposited from, however they type it', () => {
    for (const form of ['0712345678', '+254712345678', '254 712 345 678']) {
      expect(checkWithdrawalDestination(form, verified).ok).toBe(true)
    }
  })

  it('refuses a number that has never funded this account', () => {
    const res = checkWithdrawalDestination('0799000111', verified)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('unverified')
      // The message has to say what to do next, not just "no".
      expect(res.error).toMatch(/deposit/i)
    }
  })

  it('tells someone with no deposits how to get one, rather than just failing', () => {
    const res = checkWithdrawalDestination('0712345678', new Set())
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('unverified')
      expect(res.error).toMatch(/deposit from your own number/i)
    }
  })

  it('rejects an unreadable destination separately from an unverified one', () => {
    const res = checkWithdrawalDestination('abc', verified)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('unreadable')
  })
})
