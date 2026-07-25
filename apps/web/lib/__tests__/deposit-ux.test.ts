import { describe, it, expect } from 'vitest'
import {
  DEPOSIT_PRESETS,
  depositPresets,
  DIAL_INFO,
  dialInfo,
  phonePlaceholder,
  phonePrefill,
  normalizePhone,
  isValidPhone,
} from '@/lib/payments/deposit-ux'
import { CURRENCIES, type CurrencyCode } from '@/types'

const ALL = Object.keys(CURRENCIES) as CurrencyCode[]

describe('depositPresets (#9 currency-aware quick amounts)', () => {
  it('has presets for every supported currency', () => {
    for (const c of ALL) {
      expect(DEPOSIT_PRESETS[c]).toBeDefined()
      expect(depositPresets(c).length).toBe(4)
      expect(depositPresets(c).every((n) => n > 0)).toBe(true)
    }
  })

  it('presets are ascending', () => {
    for (const c of ALL) {
      const p = depositPresets(c)
      expect([...p].sort((a, b) => a - b)).toEqual(p)
    }
  })

  it('is not KES-only anymore (UGX differs from KES)', () => {
    expect(depositPresets('UGX')).not.toEqual(depositPresets('KES'))
  })
})

describe('DIAL_INFO / phone helpers (#10)', () => {
  it('has dial metadata for every currency', () => {
    for (const c of ALL) expect(DIAL_INFO[c]).toBeDefined()
  })

  it('placeholder + prefill reflect the country dial code', () => {
    expect(phonePlaceholder('KES')).toContain('+254')
    expect(phonePrefill('KES')).toBe('+254 ')
    expect(phonePrefill('USD')).toBe('')
    expect(dialInfo('UGX').dialCode).toBe('256')
  })
})

describe('normalizePhone', () => {
  it('normalizes all common Kenyan input variants to E.164', () => {
    expect(normalizePhone('0712345678', 'KES')).toBe('+254712345678')
    expect(normalizePhone('712345678', 'KES')).toBe('+254712345678')
    expect(normalizePhone('+254712345678', 'KES')).toBe('+254712345678')
    expect(normalizePhone('254712345678', 'KES')).toBe('+254712345678')
    expect(normalizePhone('00254712345678', 'KES')).toBe('+254712345678')
    expect(normalizePhone('+254 712 345 678', 'KES')).toBe('+254712345678')
    expect(normalizePhone('0712-345-678', 'KES')).toBe('+254712345678')
  })

  it('handles other countries', () => {
    expect(normalizePhone('0781234567', 'RWF')).toBe('+250781234567')
    expect(normalizePhone('79123456', 'BIF')).toBe('+25779123456')
  })

  it('passes international/USD numbers through as +digits', () => {
    expect(normalizePhone('+1 555 123 4567', 'USD')).toBe('+15551234567')
    expect(normalizePhone('', 'USD')).toBe('')
  })
})

describe('isValidPhone', () => {
  it('accepts valid national-length numbers regardless of input format', () => {
    expect(isValidPhone('0712345678', 'KES')).toBe(true)
    expect(isValidPhone('+254712345678', 'KES')).toBe(true)
    expect(isValidPhone('79123456', 'BIF')).toBe(true) // 8-digit national
  })

  it('rejects too-short / too-long / empty numbers', () => {
    expect(isValidPhone('0712', 'KES')).toBe(false)
    expect(isValidPhone('07123456789999', 'KES')).toBe(false)
    expect(isValidPhone('', 'KES')).toBe(false)
    expect(isValidPhone('abc', 'KES')).toBe(false)
  })

  it('accepts any plausible E.164 for USD/international', () => {
    expect(isValidPhone('+15551234567', 'USD')).toBe(true)
    expect(isValidPhone('123', 'USD')).toBe(false)
  })
})
