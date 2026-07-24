import { describe, it, expect } from 'vitest'
import {
  AUTH_COUNTRIES,
  currencyForCountry,
  scorePassword,
  PASSWORD_STRENGTH,
  MIN_PASSWORD_LENGTH,
  canSubmitLogin,
  canSubmitRegister,
  normalizeAuthError,
} from '@/lib/auth-form'

describe('currencyForCountry', () => {
  it('maps every supported country to its listed currency', () => {
    for (const c of AUTH_COUNTRIES) {
      expect(currencyForCountry(c.code)).toBe(c.currency)
    }
  })
  it('falls back to KES for unknown / empty codes', () => {
    expect(currencyForCountry('ZZ')).toBe('KES')
    expect(currencyForCountry('')).toBe('KES')
  })
})

describe('scorePassword', () => {
  it('returns 0 for empty', () => expect(scorePassword('')).toBe(0))
  it('rewards length', () => {
    expect(scorePassword('short')).toBe(0)
    expect(scorePassword('12345678')).toBe(1) // >=8 length only (digits, no symbol/case)
  })
  it('rewards mixed case + digits + symbols', () => {
    expect(scorePassword('Abcdefgh')).toBe(2) // >=8 + mixed case
    expect(scorePassword('Abcdefgh1!')).toBe(3) // +digit&symbol
    expect(scorePassword('Abcdefghijk1!')).toBe(4) // >=12 too
  })
  it('never exceeds 4 and indexes PASSWORD_STRENGTH safely', () => {
    for (const pw of ['', 'a', 'Abcdefghijk1!', 'x'.repeat(40) + 'A1!']) {
      const s = scorePassword(pw)
      expect(s).toBeGreaterThanOrEqual(0)
      expect(s).toBeLessThanOrEqual(4)
      expect(PASSWORD_STRENGTH[s]).toBeTruthy()
    }
  })
})

describe('canSubmitLogin', () => {
  it('true only with plausible email + non-empty password', () => {
    expect(canSubmitLogin({ email: 'a@b.co', password: 'x' })).toBe(true)
    expect(canSubmitLogin({ email: 'bad', password: 'x' })).toBe(false)
    expect(canSubmitLogin({ email: 'a@b.co', password: '' })).toBe(false)
  })
  it('false while loading', () => {
    expect(canSubmitLogin({ email: 'a@b.co', password: 'x', loading: true })).toBe(false)
  })
})

describe('canSubmitRegister', () => {
  it('needs name>1, plausible email, password>=min', () => {
    expect(canSubmitRegister({ name: 'Jo', email: 'a@b.co', password: '12345678' })).toBe(true)
    expect(canSubmitRegister({ name: 'J', email: 'a@b.co', password: '12345678' })).toBe(false)
    expect(canSubmitRegister({ name: 'Jo', email: 'bad', password: '12345678' })).toBe(false)
    expect(canSubmitRegister({ name: 'Jo', email: 'a@b.co', password: '1234567' })).toBe(false)
  })
  it('trims whitespace-only names', () => {
    expect(canSubmitRegister({ name: '   ', email: 'a@b.co', password: '12345678' })).toBe(false)
  })
  it('respects MIN_PASSWORD_LENGTH boundary', () => {
    const pw = 'x'.repeat(MIN_PASSWORD_LENGTH)
    expect(canSubmitRegister({ name: 'Jo', email: 'a@b.co', password: pw })).toBe(true)
  })
})

describe('normalizeAuthError — human, non-leaky copy', () => {
  it('maps invalid credentials', () => {
    expect(normalizeAuthError(new Error('Invalid login credentials'), 'login')).toBe(
      'Email or password is incorrect.',
    )
  })
  it('maps unconfirmed email', () => {
    expect(normalizeAuthError('Email not confirmed', 'login')).toMatch(/confirm your email/i)
  })
  it('maps already-registered (enumeration-safe wording still actionable)', () => {
    expect(normalizeAuthError('User already registered', 'register')).toMatch(/already exists/i)
  })
  it('maps rate limiting', () => {
    expect(normalizeAuthError('Email rate limit exceeded', 'register')).toMatch(/too many/i)
  })
  it('maps network errors', () => {
    expect(normalizeAuthError(new Error('Failed to fetch'), 'login')).toMatch(/network/i)
  })
  it('never echoes raw provider text on fallback', () => {
    const raw = 'weird internal supabase 500 xyz'
    const out = normalizeAuthError(raw, 'login')
    expect(out).not.toContain('xyz')
    expect(out).toBe('Could not sign you in. Please try again.')
  })
  it('handles empty / nullish input', () => {
    expect(normalizeAuthError('', 'login')).toMatch(/something went wrong/i)
    expect(normalizeAuthError(null, 'register')).toMatch(/something went wrong/i)
  })
})
