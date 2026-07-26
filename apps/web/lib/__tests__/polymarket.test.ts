import { describe, it, expect } from 'vitest'
import { normalizeMarket, mapCategory } from '@/lib/integrations/polymarket'

describe('mapCategory', () => {
  it('maps known keywords to Kichiko categories', () => {
    expect(mapCategory('US Election 2024')).toBe('politics')
    expect(mapCategory('NBA Finals')).toBe('sports')
    expect(mapCategory('Bitcoin price')).toBe('crypto')
    expect(mapCategory('Fed rate decision')).toBe('economics')
  })
  it('falls back to other', () => {
    expect(mapCategory('random nonsense')).toBe('other')
    expect(mapCategory(undefined)).toBe('other')
  })
})

describe('normalizeMarket', () => {
  it('parses outcome prices into yes/no', () => {
    const n = normalizeMarket({
      id: '123',
      question: 'Will X happen?',
      category: 'Elections',
      outcomePrices: '["0.62","0.38"]',
      volume: '15000.5',
      endDate: '2026-12-31T00:00:00Z',
      active: true,
      closed: false,
    })
    expect(n.source).toBe('polymarket')
    expect(n.externalId).toBe('123')
    expect(n.category).toBe('politics')
    expect(n.yesPrice).toBeCloseTo(0.62)
    expect(n.noPrice).toBeCloseTo(0.38)
    expect(n.volumeUsd).toBeCloseTo(15000.5)
    expect(n.active).toBe(true)
  })
  it('derives no from yes when only one price present', () => {
    const n = normalizeMarket({ id: 'a', question: 'Q', outcomePrices: '["0.7"]' })
    expect(n.yesPrice).toBeCloseTo(0.7)
    expect(n.noPrice).toBeCloseTo(0.3)
  })
  it('handles missing/garbage prices gracefully', () => {
    const n = normalizeMarket({ id: 'b', question: 'Q', outcomePrices: 'not-json' })
    expect(n.yesPrice).toBeNull()
    expect(n.volumeUsd).toBe(0)
  })
})
