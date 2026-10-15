import { describe, it, expect } from 'vitest'
import { numberToWords, amountInWords } from '../money-words'

describe('numberToWords', () => {
  it('handles the shapes a stake or payout actually takes', () => {
    expect(numberToWords(0)).toBe('zero')
    expect(numberToWords(7)).toBe('seven')
    expect(numberToWords(20)).toBe('twenty')
    expect(numberToWords(42)).toBe('forty-two')
    expect(numberToWords(100)).toBe('one hundred')
    expect(numberToWords(118)).toBe('one hundred and eighteen')
    expect(numberToWords(1_000)).toBe('one thousand')
    expect(numberToWords(1_234)).toBe('one thousand two hundred and thirty-four')
    expect(numberToWords(50_000)).toBe('fifty thousand')
    expect(numberToWords(1_000_000)).toBe('one million')
  })

  it('separates the pair this exists to disambiguate', () => {
    // The whole point: one mistyped zero must not read alike.
    expect(numberToWords(5_000)).toBe('five thousand')
    expect(numberToWords(50_000)).toBe('fifty thousand')
    expect(numberToWords(5_000)).not.toBe(numberToWords(50_000))
  })

  it('floors fractions, because the rail moves whole shillings', () => {
    expect(numberToWords(1_500.75)).toBe('one thousand five hundred')
  })

  it('does not throw on anything unusable', () => {
    expect(numberToWords(NaN)).toBe('')
    expect(numberToWords(Infinity)).toBe('')
    expect(numberToWords(-20)).toBe('minus twenty')
  })
})

describe('amountInWords', () => {
  it('names the unit per currency and reads as a sentence', () => {
    expect(amountInWords(5_000, 'KES')).toBe('Five thousand shillings')
    expect(amountInWords(250, 'RWF')).toBe('Two hundred and fifty francs')
    expect(amountInWords(12, 'USD')).toBe('Twelve dollars')
  })

  it('falls back to the code for a currency it does not name', () => {
    expect(amountInWords(5, 'XYZ')).toBe('Five XYZ')
  })

  it('returns empty rather than a broken sentence', () => {
    expect(amountInWords(NaN, 'KES')).toBe('')
  })
})
