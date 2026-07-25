import { describe, it, expect } from 'vitest'
import { normalizeLabel, isOptionLabelRedundant, distinctOptionLabel } from '@/lib/portfolio/labels'

describe('normalizeLabel', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeLabel('Kenyan wins 2026 Berlin Marathon?')).toBe('kenyan wins 2026 berlin marathon')
    expect(normalizeLabel('  Above  3%  ')).toBe('above 3')
  })
})

describe('isOptionLabelRedundant', () => {
  it('treats a title and its punctuation-only variant as redundant (the real bug)', () => {
    // Market title carried a "?" while the single option label did not.
    expect(isOptionLabelRedundant('Kenyan wins 2026 Berlin Marathon?', 'Kenyan wins 2026 Berlin Marathon')).toBe(true)
  })

  it('treats missing/empty labels as redundant', () => {
    expect(isOptionLabelRedundant('Some market', null)).toBe(true)
    expect(isOptionLabelRedundant('Some market', '   ')).toBe(true)
  })

  it('treats containment as redundant', () => {
    expect(isOptionLabelRedundant('Who wins the 2026 election?', 'wins the 2026 election')).toBe(true)
  })

  it('keeps a genuinely distinct multiple-choice pick', () => {
    expect(isOptionLabelRedundant('US Presidential Election 2028', 'Democratic candidate')).toBe(false)
    expect(isOptionLabelRedundant('BTC price on Dec 31?', 'Above $100k')).toBe(false)
  })
})

describe('distinctOptionLabel', () => {
  it('returns null when the option label just duplicates the title', () => {
    expect(distinctOptionLabel('Kenyan wins 2026 Berlin Marathon?', 'Kenyan wins 2026 Berlin Marathon')).toBeNull()
  })

  it('returns the trimmed label when it adds information', () => {
    expect(distinctOptionLabel('BTC price on Dec 31?', '  Above $100k  ')).toBe('Above $100k')
  })
})
