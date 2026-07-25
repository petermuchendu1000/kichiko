import { describe, it, expect } from 'vitest'
import { usdToLocal } from '@/lib/currency'
import {
  formatVolume,
  formatPercent,
  slugify,
  truncate,
  avatarColor,
} from '@/lib/utils'

describe('formatVolume', () => {
  // Amounts are USD in, KES out; expected mirrors the converted-KES tiering.
  const expected = (usd: number) => {
    const kes = usdToLocal(usd, 'KES')
    if (kes >= 1_000_000_000) return `KSh ${(kes / 1_000_000_000).toFixed(1)}B`
    if (kes >= 1_000_000) return `KSh ${(kes / 1_000_000).toFixed(1)}M`
    if (kes >= 1_000) return `KSh ${(kes / 1_000).toFixed(1)}K`
    return `KSh ${Math.round(kes)}`
  }
  it('formats millions', () => expect(formatVolume(2_500_000)).toBe(expected(2_500_000)))
  it('formats thousands', () => expect(formatVolume(12_300)).toBe(expected(12_300)))
  it('formats small values', () => expect(formatVolume(450)).toBe(expected(450)))
})

describe('formatPercent', () => {
  it('defaults to 0 decimals', () => expect(formatPercent(0.731)).toBe('73%'))
  it('respects decimals', () => expect(formatPercent(0.7311, 1)).toBe('73.1%'))
})

describe('slugify', () => {
  it('lowercases and dashes', () =>
    expect(slugify('Will BTC hit $100k?')).toBe('will-btc-hit-100k'))
  it('trims dashes', () => expect(slugify('  Hello  World  ')).toBe('hello-world'))
})

describe('truncate', () => {
  it('leaves short strings', () => expect(truncate('abc', 10)).toBe('abc'))
  it('adds ellipsis', () => expect(truncate('abcdefghij', 5)).toBe('abcde…'))
})

describe('avatarColor', () => {
  it('is deterministic', () =>
    expect(avatarColor('user-123')).toBe(avatarColor('user-123')))
  it('returns a tailwind bg class', () =>
    expect(avatarColor('zeta')).toMatch(/^bg-[a-z]+-500$/))
})
