// The footer's topic links and the sitemap read the same list, so these guard
// the contract between them: every link must be a real, indexable category
// page, and the catch-all bucket must stay out of both.
import { describe, it, expect } from 'vitest'
import { SEO_CATEGORIES, categoryHref, categoryLinkLabel } from '../categories'
import { MARKET_CATEGORIES, normalizeCategory } from '@/lib/search'

describe('SEO categories', () => {
  it('excludes the catch-all bucket', () => {
    expect(SEO_CATEGORIES).not.toContain('other')
    expect(SEO_CATEGORIES).toHaveLength(MARKET_CATEGORIES.length - 1)
  })

  it('every slug survives the parser the markets page uses', () => {
    // A link the page would normalise to null is a link to the unfiltered
    // board wearing a category's label.
    for (const c of SEO_CATEGORIES) {
      expect(normalizeCategory(c)).toBe(c)
    }
  })

  it('builds hrefs the markets route actually reads', () => {
    for (const c of SEO_CATEGORIES) {
      const href = categoryHref(c)
      expect(href.startsWith('/markets?category=')).toBe(true)
      const param = new URL(href, 'https://example.test').searchParams.get('category')
      expect(normalizeCategory(param)).toBe(c)
    }
  })

  it('labels are distinct and non-empty', () => {
    const labels = SEO_CATEGORIES.map(categoryLinkLabel)
    expect(new Set(labels).size).toBe(labels.length)
    for (const l of labels) expect(l.trim().length).toBeGreaterThan(0)
  })

  it('hrefs are unique, so React keys and sitemap URLs cannot collide', () => {
    const hrefs = SEO_CATEGORIES.map(categoryHref)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
})
