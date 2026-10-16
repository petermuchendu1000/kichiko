// lib/__tests__/option-delta.test.ts
// The change figure beside each outcome's probability (migration 114).
import { describe, it, expect } from 'vitest'
import { toDeltaMap, isMeaningful, formatDelta, DELTA_FLOOR, type DeltaRow } from '../markets/option-delta'

/** The measured shape of a `market_option_deltas` row. */
const row = (o: Partial<Record<string, unknown>> = {}) => ({
  market_option_id: 'opt-1',
  first_price: 0.526,
  last_price: 0.464,
  delta: -0.062,
  points: 387,
  ...o,
}) as unknown as DeltaRow

describe('toDeltaMap', () => {
  it('shapes the measured rows from ke-2027-president', () => {
    const m = toDeltaMap([
      row(),
      row({ market_option_id: 'opt-2', first_price: 0.208, last_price: 0.238, delta: 0.03, points: 381 }),
    ])
    expect(m['opt-1'].delta).toBeCloseTo(-0.062, 10)
    expect(m['opt-2'].delta).toBeCloseTo(0.03, 10)
    expect(m['opt-1'].first).toBeCloseTo(0.526, 10)
  })

  it('reads NUMERIC that arrived as a string', () => {
    // supabase-js hands NUMERIC back as a string often enough that the naive
    // version produced "+NaN" on screen — the same trap that made
    // lastChangeMs() compare "30730" with "30730.00".
    const m = toDeltaMap([row({ delta: '-0.062', first_price: '0.526', points: 387 })])
    expect(m['opt-1'].delta).toBeCloseTo(-0.062, 10)
    expect(Number.isFinite(m['opt-1'].first)).toBe(true)
  })

  it('drops rows it cannot trust rather than rendering NaN', () => {
    expect(toDeltaMap(null)).toEqual({})
    expect(toDeltaMap([row({ delta: null })])).toEqual({})
    expect(toDeltaMap([row({ delta: 'not-a-number' })])).toEqual({})
    expect(toDeltaMap([row({ market_option_id: null })])).toEqual({})
  })

  it('refuses a single datapoint: one price is a level, not a move', () => {
    // The RPC already filters these out; the client refuses them too, because
    // a 0.0 that looks like "traded all day and ended flat" is worse than no
    // figure at all.
    expect(toDeltaMap([row({ points: 1, delta: 0 })])).toEqual({})
  })
})

describe('isMeaningful', () => {
  it('hides movement that rounds to nothing', () => {
    // A green caret beside "0.0" asserts a direction the number cannot carry.
    expect(isMeaningful({ delta: 0.0004, first: 0.5, points: 9 })).toBe(false)
    expect(isMeaningful({ delta: -0.0004, first: 0.5, points: 9 })).toBe(false)
    expect(isMeaningful(undefined)).toBe(false)
  })

  it('shows anything that renders as a non-zero tenth', () => {
    expect(isMeaningful({ delta: DELTA_FLOOR, first: 0.5, points: 9 })).toBe(true)
    expect(isMeaningful({ delta: -0.062, first: 0.526, points: 387 })).toBe(true)
  })

  it('agrees with what formatDelta would print', () => {
    // The floor and the formatter must not disagree: anything shown must not
    // print "0.0", and anything hidden must have been going to.
    for (const d of [0.0001, 0.0005, 0.00099, 0.001, 0.0015, 0.062]) {
      const shown = isMeaningful({ delta: d, first: 0.5, points: 9 })
      const printed = formatDelta({ delta: d, first: 0.5, points: 9 }).magnitude
      if (shown) expect(printed).not.toBe('0.0')
      else expect(printed).toBe('0.0')
    }
  })
})

describe('formatDelta', () => {
  it('puts the sign in the caret and never repeats it in the number', () => {
    const down = formatDelta({ delta: -0.062, first: 0.526, points: 387 })
    expect(down.caret).toBe('▼')
    expect(down.up).toBe(false)
    expect(down.magnitude).toBe('6.2')
    expect(down.magnitude).not.toContain('-')

    const up = formatDelta({ delta: 0.057, first: 0.08, points: 380 })
    expect(up.caret).toBe('▲')
    expect(up.magnitude).toBe('5.7')
  })

  it('reports percentage POINTS, not a percentage of the old value', () => {
    // Kalonzo went 8.0% -> 13.7%. That is 5.7 points, and also a 71% rise.
    // The board says points; saying 71 would be a different, louder claim.
    expect(formatDelta({ delta: 0.057, first: 0.08, points: 380 }).magnitude).toBe('5.7')
  })

  it('treats exactly zero as up, so the caret is never absent', () => {
    // Unreachable through isMeaningful, but the type allows it and a missing
    // glyph would shift the row's layout.
    expect(formatDelta({ delta: 0, first: 0.5, points: 9 }).caret).toBe('▲')
  })
})
