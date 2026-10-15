import { describe, it, expect } from 'vitest'
import { resolutionSourceName } from '../source-name'

describe('resolutionSourceName', () => {
  it('names the authority behind each stored source', () => {
    expect(resolutionSourceName('https://www.iebc.or.ke/')).toBe('iebc.or.ke')
    expect(resolutionSourceName('https://statistics.knbs.or.ke/')).toBe('statistics.knbs.or.ke')
    expect(resolutionSourceName('https://www.centralbank.go.ke/central-bank-rate/')).toBe('centralbank.go.ke')
    expect(resolutionSourceName('https://www.coinbase.com/price/bitcoin')).toBe('coinbase.com')
    expect(resolutionSourceName('http://www.parliament.go.ke/')).toBe('parliament.go.ke')
  })

  it('keeps a meaningful subdomain, strips only www', () => {
    expect(resolutionSourceName('https://statistics.knbs.or.ke/')).not.toBe('knbs.or.ke')
  })

  it('returns null rather than throwing on anything unusable', () => {
    for (const v of [null, undefined, '', 'not a url', 'javascript:alert(1)//']) {
      expect(() => resolutionSourceName(v as string)).not.toThrow()
    }
    expect(resolutionSourceName(null)).toBeNull()
    expect(resolutionSourceName('')).toBeNull()
    expect(resolutionSourceName('not a url')).toBeNull()
  })
})
