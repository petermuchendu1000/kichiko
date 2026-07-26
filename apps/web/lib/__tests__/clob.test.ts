import { describe, it, expect } from 'vitest'
import {
  clampPriceCents,
  complementCents,
  formatCents,
  formatPercent,
  dualPriceLabel,
  withCumulativeTotals,
  shapeBook,
  clobOrderSchema,
  clobErrorFor,
  CLOB_MIN_CENTS,
  CLOB_MAX_CENTS,
  estimateClobBuyShares,
  estimateClobSellProceedsUsd,
  clobAvailableShares,
  buildClobOrderPayload,
} from '@/lib/clob'

describe('clob price ticks', () => {
  it('snaps to the 0.1¢ grid', () => {
    expect(clampPriceCents(19.84)).toBe(19.8)
    expect(clampPriceCents(19.86)).toBe(19.9)
    expect(clampPriceCents(50)).toBe(50)
  })
  it('clamps to the tradable band', () => {
    expect(clampPriceCents(0)).toBe(CLOB_MIN_CENTS)
    expect(clampPriceCents(-5)).toBe(CLOB_MIN_CENTS)
    expect(clampPriceCents(200)).toBe(CLOB_MAX_CENTS)
    expect(clampPriceCents(NaN)).toBe(CLOB_MIN_CENTS)
  })
  it('complement sums to 100¢ ($1 set)', () => {
    expect(complementCents(20)).toBe(80)
    expect(complementCents(19.8)).toBe(80.2)
    expect(complementCents(45)).toBe(55)
  })
})

describe('clob formatting (PM dual %+¢)', () => {
  it('trims trailing .0 like PM', () => {
    expect(formatCents(20)).toBe('20%')
    expect(formatCents(19.8)).toBe('19.8%')
    expect(formatPercent(20)).toBe('20%')
    expect(formatPercent(19.8)).toBe('19.8%')
  })
  it('dual label exposes the probability percent', () => {
    expect(dualPriceLabel(19.8)).toEqual({ percent: '19.8%' })
  })
})

describe('withCumulativeTotals (PM TOTAL column)', () => {
  it('accumulates shares + notional inside-out and sets depth ratio', () => {
    // bids best→worst: 19.7¢×100, 19.6¢×100
    const rows = withCumulativeTotals([
      { price: 19.7, size: 100 },
      { price: 19.6, size: 100 },
    ])
    expect(rows[0].totalShares).toBe(100)
    expect(rows[1].totalShares).toBe(200)
    // notional cumulative: 19.7 → 19.7+19.6
    expect(rows[0].totalUsd).toBeCloseTo(19.7, 6)
    expect(rows[1].totalUsd).toBeCloseTo(39.3, 6)
    // deepest level fills the depth bar
    expect(rows[1].depthPct).toBe(1)
    expect(rows[0].depthPct).toBeCloseTo(19.7 / 39.3, 6)
  })
  it('handles an empty side', () => {
    expect(withCumulativeTotals([])).toEqual([])
  })
})

describe('shapeBook', () => {
  it('shapes raw RPC output into cumulative UI model', () => {
    const book = shapeBook({
      market_id: 'm', market_option_id: 'o', outcome_side: 'yes',
      bids: [{ price: 19.7, size: 100 }], asks: [{ price: 20.1, size: 50 }],
      last: 19.7, best_bid: 19.7, best_ask: 20.1, spread: 0.4,
    })
    expect(book.bids[0].totalUsd).toBeCloseTo(19.7, 6)
    expect(book.asks[0].totalShares).toBe(50)
    expect(book.spread).toBe(0.4)
  })
})

describe('clobOrderSchema', () => {
  const base = { engine: 'clob', market_id: '11111111-1111-1111-1111-111111111111',
    market_option_id: '22222222-2222-2222-2222-222222222222', outcome_side: 'yes',
    action: 'buy', currency: 'USD' } as const

  it('accepts a valid limit order', () => {
    const r = clobOrderSchema.safeParse({ ...base, order_type: 'limit', price_cents: 60, size: 100 })
    expect(r.success).toBe(true)
  })
  it('rejects a limit order without price_cents', () => {
    const r = clobOrderSchema.safeParse({ ...base, order_type: 'limit', size: 100 })
    expect(r.success).toBe(false)
  })
  it('rejects a limit order without size', () => {
    const r = clobOrderSchema.safeParse({ ...base, order_type: 'limit', price_cents: 60 })
    expect(r.success).toBe(false)
  })
  it('accepts a market order with amount_local', () => {
    const r = clobOrderSchema.safeParse({ ...base, order_type: 'market', amount_local: 50 })
    expect(r.success).toBe(true)
  })
  it('rejects a market order with neither size nor amount', () => {
    const r = clobOrderSchema.safeParse({ ...base, order_type: 'market' })
    expect(r.success).toBe(false)
  })
  it('rejects out-of-band price_cents', () => {
    expect(clobOrderSchema.safeParse({ ...base, order_type: 'limit', price_cents: 150, size: 1 }).success).toBe(false)
    expect(clobOrderSchema.safeParse({ ...base, order_type: 'limit', price_cents: 0, size: 1 }).success).toBe(false)
  })
})

describe('clobErrorFor (SQLSTATE → HTTP)', () => {
  it('maps insufficient funds to 402', () => {
    expect(clobErrorFor('... USING ERRCODE P0006 ...')).toEqual({ status: 402, error: 'Insufficient balance' })
  })
  it('maps sell-not-yet to 409', () => {
    expect(clobErrorFor('boom P0100 boom')?.status).toBe(409)
  })
  it('maps cancel guards', () => {
    expect(clobErrorFor('P0111')?.status).toBe(403)
    expect(clobErrorFor('P0112')?.status).toBe(409)
  })
  it('maps abuse-prevention guards to 429', () => {
    expect(clobErrorFor('P0130')?.status).toBe(429)
    expect(clobErrorFor('P0131')?.status).toBe(429)
    expect(clobErrorFor('P0132')?.status).toBe(429)
    expect(clobErrorFor({ code: 'P0132', message: 'slow down' })?.status).toBe(429)
  })
  it('returns null for unknown codes', () => {
    expect(clobErrorFor('P9999 nope')).toBeNull()
  })

  // Regression: real PostgREST/supabase-js errors carry the SQLSTATE in
  // `.code`, and the message is a human string WITHOUT the code. The mapper
  // must match on `.code`, else every RPC error fell through to a generic 500
  // ("Failed to place order") — which is exactly the bug this covers.
  it('maps by error.code even when the message omits the code', () => {
    expect(
      clobErrorFor({ code: 'P0006', message: 'Insufficient balance. Available: 0.000000, Required: 130.30' }),
    ).toEqual({ status: 402, error: 'Insufficient balance' })
  })
  it('maps cancel/sell guards by error.code', () => {
    expect(clobErrorFor({ code: 'P0111', message: 'not your order' })?.status).toBe(403)
    expect(clobErrorFor({ code: 'P0113', message: 'Not enough shares to sell (available 1, requested 5)' })?.status).toBe(409)
  })
  it('returns null for an object with an unknown/absent code', () => {
    expect(clobErrorFor({ code: 'P9999', message: 'nope' })).toBeNull()
    expect(clobErrorFor({ message: 'no code at all' })).toBeNull()
    expect(clobErrorFor(null)).toBeNull()
    expect(clobErrorFor(undefined)).toBeNull()
  })
})

describe('CLOB ticket estimate helpers', () => {
  it('estimateClobBuyShares: budget / (ask/100), floored to 6dp', () => {
    // $47.60 at 23.8¢ → 200 shares exactly.
    expect(estimateClobBuyShares(47.6, 23.8)).toBe(200)
    // $10 at 20¢ → 50 shares.
    expect(estimateClobBuyShares(10, 20)).toBe(50)
  })
  it('estimateClobBuyShares: guards zero/negative/null price + budget', () => {
    expect(estimateClobBuyShares(10, null)).toBe(0)
    expect(estimateClobBuyShares(10, 0)).toBe(0)
    expect(estimateClobBuyShares(0, 20)).toBe(0)
    expect(estimateClobBuyShares(-5, 20)).toBe(0)
  })
  it('estimateClobSellProceedsUsd: size × price/100', () => {
    // 100 shares at 22.6¢ → $22.60.
    expect(estimateClobSellProceedsUsd(100, 22.6)).toBeCloseTo(22.6, 10)
    expect(estimateClobSellProceedsUsd(0, 50)).toBe(0)
    expect(estimateClobSellProceedsUsd(10, null)).toBe(0)
  })
  it('clobAvailableShares: shares − reserved, never negative', () => {
    expect(clobAvailableShares(1000, 250)).toBe(750)
    expect(clobAvailableShares(100, 0)).toBe(100)
    expect(clobAvailableShares(100, 200)).toBe(0) // over-reserved → clamp to 0
    expect(clobAvailableShares(0, 0)).toBe(0)
  })
})

describe('buildClobOrderPayload', () => {
  const ids = {
    marketId: '11111111-1111-1111-1111-111111111111',
    marketOptionId: '22222222-2222-2222-2222-222222222222',
    outcomeSide: 'yes' as const,
    currency: 'KES' as const,
  }
  it('market buy: amount-denominated, always market, no price', () => {
    const p = buildClobOrderPayload({ ...ids, action: 'buy', orderType: 'market', amountLocal: 500 })
    expect(p).toMatchObject({ engine: 'clob', action: 'buy', order_type: 'market', amount_local: 500 })
    expect(p).not.toHaveProperty('price_cents')
    expect(p).not.toHaveProperty('size')
    // The result is a valid CLOB order body.
    expect(clobOrderSchema.safeParse(p).success).toBe(true)
  })
  it('limit buy: share-denominated + clamped price (rests on the book, friction #19)', () => {
    const p = buildClobOrderPayload({ ...ids, action: 'buy', orderType: 'limit', size: 10, priceCents: 22.64 })
    expect(p).toMatchObject({ engine: 'clob', action: 'buy', order_type: 'limit', size: 10, price_cents: 22.6 })
    expect(p).not.toHaveProperty('amount_local')
    // A valid CLOB order body the RPC accepts as a resting bid.
    expect(clobOrderSchema.safeParse(p).success).toBe(true)
  })
  it('clamps an out-of-band limit BUY price into the tradable band', () => {
    expect(buildClobOrderPayload({ ...ids, action: 'buy', orderType: 'limit', size: 5, priceCents: 250 }).price_cents).toBe(CLOB_MAX_CENTS)
    expect(buildClobOrderPayload({ ...ids, action: 'buy', orderType: 'limit', size: 5, priceCents: 0 }).price_cents).toBe(CLOB_MIN_CENTS)
  })
  it('market sell: share-denominated, no price', () => {
    const p = buildClobOrderPayload({ ...ids, action: 'sell', orderType: 'market', size: 100 })
    expect(p).toMatchObject({ action: 'sell', order_type: 'market', size: 100 })
    expect(p).not.toHaveProperty('price_cents')
    expect(clobOrderSchema.safeParse(p).success).toBe(true)
  })
  it('limit sell: share-denominated + clamped price on the 0.1¢ grid', () => {
    const p = buildClobOrderPayload({ ...ids, action: 'sell', orderType: 'limit', size: 100, priceCents: 22.64 })
    expect(p).toMatchObject({ action: 'sell', order_type: 'limit', size: 100, price_cents: 22.6 })
    expect(clobOrderSchema.safeParse(p).success).toBe(true)
  })
  it('clamps an out-of-band limit price into the tradable band', () => {
    expect(buildClobOrderPayload({ ...ids, action: 'sell', orderType: 'limit', size: 5, priceCents: 250 }).price_cents).toBe(CLOB_MAX_CENTS)
    expect(buildClobOrderPayload({ ...ids, action: 'sell', orderType: 'limit', size: 5, priceCents: 0 }).price_cents).toBe(CLOB_MIN_CENTS)
  })
})
