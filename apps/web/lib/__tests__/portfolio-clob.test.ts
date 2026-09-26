import { describe, it, expect } from 'vitest'
import { toValuationInput, summarizePortfolio, computePositionPnl } from '@/lib/portfolio'

// Audit 6.16: CLOB option positions carry a side; the portfolio valued every
// option position as YES (100 NO shares on a 20% candidate showed $20, not
// $80; a NO holder showed as the winner when YES won) and ignored P&L
// realized by partial sells.
const market = (status = 'active') => ({ id: 'm1', status, yes_price: 0.5, no_price: 0.5, resolved_outcome: null }) as never
const pos = (side: 'yes' | 'no' | null, extra: Record<string, unknown> = {}) =>
  ({ id: 'p1', side, market_option_id: 'o1', shares: 100, total_invested_usd: 70, is_active: true, ...extra }) as never

describe('portfolio: CLOB option positions', () => {
  it('100 NO shares on a 20% candidate are worth $80', () => {
    const v = toValuationInput(pos('no'), market(), { price: 0.2, is_winner: null })
    const pnl = computePositionPnl(v, v.market)
    expect(pnl.currentValue).toBeCloseTo(80)
    expect(pnl.unrealizedPnl).toBeCloseTo(10)
  })
  it('YES wins: the NO holder lost; YES loses: the NO holder won', () => {
    const lost = toValuationInput(pos('no', { is_active: true }), market('resolved'), { price: 1, is_winner: true })
    expect(computePositionPnl(lost, lost.market).outcome).toBe('resolved_loss')
    const won = toValuationInput(pos('no', { is_active: true }), market('resolved'), { price: 0, is_winner: false })
    const w = computePositionPnl(won, won.market)
    expect(w.outcome).toBe('resolved_win')
    expect(w.realizedPnl).toBeCloseTo(30)   // 100 x $1 - 70
  })
  it('legacy AMM option positions (NULL side) are still YES holdings', () => {
    const v = toValuationInput(pos(null), market(), { price: 0.2, is_winner: null })
    expect(v.side).toBe('yes')
    expect(computePositionPnl(v, v.market).currentValue).toBeCloseTo(20)
  })
  it('an open CLOB position includes P&L realized by partial sells', () => {
    const v = toValuationInput(pos('yes', { realized_pnl_usd: 5 }), market(), { price: 0.8, is_winner: null })
    const { summary } = summarizePortfolio([v])
    expect(summary.totalRealizedPnl).toBeCloseTo(5)
    expect(summary.totalUnrealizedPnl).toBeCloseTo(10)   // 100 x 0.8 - 70
    expect(summary.totalPnl).toBeCloseTo(15)
  })
  it('a CLOB position the database settled uses its stored realized P&L (no double count)', () => {
    // settled: realized_pnl_usd = sells (5) + payout (100) - invested (70) = 35
    const v = toValuationInput(pos('yes', { is_active: false, realized_pnl_usd: 35 }), market('resolved'), { price: 1, is_winner: true })
    const { summary } = summarizePortfolio([v])
    expect(summary.totalRealizedPnl).toBeCloseTo(35)
    expect(summary.settledCount).toBe(1)
  })
})
