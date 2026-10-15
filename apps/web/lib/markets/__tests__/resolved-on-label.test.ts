// The date half of the resolved banner (ruling C6). No market has resolved
// yet, in production or anywhere else — all 38 are active — so the banner
// itself cannot be exercised in a browser without writing a fake outcome into
// a real-money ledger. The pure part is tested here instead.
import { describe, it, expect } from 'vitest'
import { resolvedOnLabel } from '@/components/markets/resolved-banner'

describe('resolvedOnLabel', () => {
  it('spells the month out, so 2026-01-12 cannot be read as 12 January or 1 December', () => {
    expect(resolvedOnLabel('2027-01-12T08:30:00Z')).toBe('12 January 2027')
  })

  it('handles a plain date as well as a timestamp', () => {
    expect(resolvedOnLabel('2026-12-31')).toContain('December')
  })

  it('returns null rather than "Invalid Date" on anything unusable', () => {
    for (const v of [null, undefined, '', 'not a date']) {
      expect(resolvedOnLabel(v as string)).toBeNull()
    }
  })
})
