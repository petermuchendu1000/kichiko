import { describe, it, expect } from 'vitest'
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatCompact,
  formatRelativeTime,
} from '@/lib/format'

const D = new Date('2026-07-03T10:05:00Z') // 13:05 in Africa/Nairobi (UTC+3)

describe('format — dates (locale + EA timezone)', () => {
  it('formats an absolute date', () => {
    expect(formatDate(D, 'en')).toMatch(/2026/)
    expect(formatDate(D, 'en')).toMatch(/Jul/)
  })
  it('formats date+time shifted to Nairobi tz (UTC+3): 10:05Z -> 01:05 PM', () => {
    // en defaults to 12h; the key assertion is the +3h timezone shift applied.
    expect(formatDateTime(D, 'en')).toMatch(/01:05/)
  })
  it('falls back to default locale for unknown locale', () => {
    expect(formatDate(D, 'xx')).toMatch(/2026/)
  })
})

describe('format — numbers', () => {
  it('groups numbers', () => {
    expect(formatNumber(8200, 'en')).toBe('8,200')
  })
  it('formats percent from a ratio', () => {
    expect(formatPercent(0.62, 'en')).toBe('62%')
    expect(formatPercent(0.625, 'en', 1)).toBe('62.5%')
  })
  it('compacts large numbers', () => {
    expect(formatCompact(2_400_000, 'en')).toBe('2.4M')
  })
})

describe('format — relative time', () => {
  it('past and future', () => {
    const base = new Date('2026-07-03T12:00:00Z')
    expect(formatRelativeTime(new Date('2026-07-01T12:00:00Z'), 'en', base)).toMatch(/2 days ago/)
    expect(formatRelativeTime(new Date('2026-07-06T12:00:00Z'), 'en', base)).toMatch(/in 3 days/)
  })
})

describe('formatProbability (work plan v2, PR-1)', () => {
  it('shows whole-number percentages with honest edges', async () => {
    const { formatProbability } = await import('@/lib/format')
    expect(formatProbability(0.786)).toBe('79%')
    expect(formatProbability(0.5)).toBe('50%')
    expect(formatProbability(0.004)).toBe('<1%')
    expect(formatProbability(0.996)).toBe('>99%')
    expect(formatProbability(0)).toBe('0%')
    expect(formatProbability(1)).toBe('100%')
  })
})
