// lib/__tests__/comment-holdings.test.ts
// The disclosure badge beside a commenter's name (matrix C10, migration 115).
import { describe, it, expect } from 'vitest'
import { toHoldingMap, describeHolding, type HoldingRow } from '../markets/comment-holdings'

const row = (o: Partial<HoldingRow> = {}): HoldingRow => ({
  user_id: 'u1',
  option_label: 'William Ruto',
  side: 'yes',
  ...o,
})

describe('toHoldingMap', () => {
  it('shapes the measured rows', () => {
    const m = toHoldingMap([row(), row({ user_id: 'u2', option_label: 'Rigathi Gachagua', side: 'no' })])
    expect(m.u1).toEqual({ optionLabel: 'William Ruto', side: 'yes' })
    expect(m.u2).toEqual({ optionLabel: 'Rigathi Gachagua', side: 'no' })
  })

  it('drops a row whose side is not exactly yes or no', () => {
    // A badge that guesses the side is worse than no badge: it reads as a
    // disclosure while asserting the opposite of the truth.
    expect(toHoldingMap([row({ side: null })])).toEqual({})
    expect(toHoldingMap([row({ side: 'YES' })])).toEqual({})
    expect(toHoldingMap([row({ side: '' })])).toEqual({})
    expect(toHoldingMap([row({ user_id: null })])).toEqual({})
    expect(toHoldingMap(null)).toEqual({})
  })

  it('keeps a binary market’s null option label', () => {
    expect(toHoldingMap([row({ option_label: null })]).u1.optionLabel).toBeNull()
  })

  it('never carries a size, whatever the row contains', () => {
    // The whole point of migration 115: the RPC returns no shares, and if one
    // ever appeared the map must not pass it through to the client.
    const sneaky = { ...row(), shares: 5889.5, current_value_usd: 1234 } as unknown as HoldingRow
    const m = toHoldingMap([sneaky])
    expect(Object.keys(m.u1).sort()).toEqual(['optionLabel', 'side'])
  })
})

describe('describeHolding', () => {
  it('says which side in words, so colour is never the only carrier', () => {
    const backs = describeHolding({ optionLabel: 'William Ruto', side: 'yes' }, 'Grace Simiyu')
    expect(backs.label).toBe('Backs William Ruto')
    expect(backs.backing).toBe(true)

    const against = describeHolding({ optionLabel: 'William Ruto', side: 'no' }, 'rehema.ye')
    expect(against.label).toBe('Against William Ruto')
    expect(against.backing).toBe(false)
  })

  it('gives a screen reader the whole sentence', () => {
    // The badge sits beside a name and means nothing without it; a reader who
    // cannot see that adjacency needs the subject spelled out.
    const d = describeHolding({ optionLabel: 'Rigathi Gachagua', side: 'no' }, 'Karen Owino')
    expect(d.description).toBe('Karen Owino holds a position against Rigathi Gachagua')
    expect(d.description).toContain('Karen Owino')
  })

  it('degrades to Yes/No on a binary market, where there is no outcome to name', () => {
    expect(describeHolding({ optionLabel: null, side: 'yes' }, 'Ian Abdi').label).toBe('Holds Yes')
    expect(describeHolding({ optionLabel: null, side: 'no' }, 'Ian Abdi').label).toBe('Holds No')
    expect(describeHolding({ optionLabel: null, side: 'no' }, 'Ian Abdi').description)
      .toBe('Ian Abdi holds a No position in this market')
  })

  it('never states an amount', () => {
    // Where we diverge from Polymarket on purpose: their commenters are
    // pseudonymous wallets, ours are named KYC'd Kenyans, and "holds 5,889
    // shares" about an identified person is personal financial data the
    // reader does not need in order to discount an argument.
    for (const side of ['yes', 'no'] as const) {
      const d = describeHolding({ optionLabel: 'William Ruto', side }, 'Tabitha Chebet')
      expect(d.label).not.toMatch(/\d/)
      expect(d.description).not.toMatch(/\d/)
      expect(d.description.toLowerCase()).not.toContain('share')
    }
  })
})
