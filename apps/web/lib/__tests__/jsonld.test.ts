import { describe, it, expect } from 'vitest'
import { safeJsonLd } from '@/lib/seo/jsonld'

describe('safeJsonLd (H5: JSON-LD XSS)', () => {
  it('neutralizes a </script><script> breakout in a creator-controlled field', () => {
    const payload = {
      '@context': 'https://schema.org',
      '@type': 'Question',
      name: 'Will it moon? </script><script>alert(document.cookie)</script>',
    }
    const out = safeJsonLd(payload)

    // No raw angle brackets survive, so the value can never close the enclosing
    // <script type="application/ld+json"> block or open a new element.
    expect(out).not.toContain('<')
    expect(out).not.toContain('>')
    expect(out).not.toContain('</script>')
    expect(out).toContain('\\u003c')
    expect(out).toContain('\\u003e')

    // Still valid JSON that round-trips to the original object — crawlers read
    // exactly the same structured data.
    expect(JSON.parse(out)).toEqual(payload)
  })

  it('escapes ampersands and U+2028 / U+2029 line separators', () => {
    const value = { text: 'Tom & Jerry\u2028line\u2029sep' }
    const out = safeJsonLd(value)

    expect(out).not.toContain('&')
    expect(out).toContain('\\u0026')
    expect(out).toContain('\\u2028')
    expect(out).toContain('\\u2029')
    expect(JSON.parse(out)).toEqual(value)
  })

  it('leaves safe content structurally intact', () => {
    const value = { a: 1, b: 'plain text', c: ['x', 'y'] }
    expect(JSON.parse(safeJsonLd(value))).toEqual(value)
  })
})
