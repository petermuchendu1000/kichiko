import { describe, it, expect } from 'vitest'
import {
  num,
  marketAccruedRewardUsd,
  accruedRewardUsd,
  paidRewardUsd,
  totalVolumeUsd,
  countByStatus,
  rewardByMonth,
  summarizeCreatorOverview,
  type CreatorMarketRow,
  type CreatorRewardTxnRow,
} from '@/lib/creator/earnings'

function market(over: Partial<CreatorMarketRow>): CreatorMarketRow {
  return {
    id: Math.random().toString(36).slice(2),
    status: 'active',
    total_volume_usd: 0,
    creator_reward_rate: 0.0025,
    unique_bettors: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

function txn(over: Partial<CreatorRewardTxnRow>): CreatorRewardTxnRow {
  return { amount_usd: 0, status: 'completed', created_at: '2026-01-01T00:00:00Z', market_id: null, ...over }
}

describe('num()', () => {
  it('coerces Postgres NUMERIC strings and guards non-finite/null', () => {
    expect(num('12.5')).toBe(12.5)
    expect(num(3)).toBe(3)
    expect(num(null)).toBe(0)
    expect(num('')).toBe(0)
    expect(num(undefined)).toBe(0)
    expect(num('not-a-number')).toBe(0)
  })
})

describe('accrued reward (volume × rate) — no hardcoded rate', () => {
  it('computes a single market accrual from its own fields', () => {
    // 1,000,000 USD volume × 0.0025 (0.25%) = 2,500 USD
    expect(marketAccruedRewardUsd(market({ total_volume_usd: 1_000_000, creator_reward_rate: 0.0025 }))).toBe(2500)
  })

  it('sums accrual across markets with differing per-market rates', () => {
    const markets = [
      market({ total_volume_usd: 100_000, creator_reward_rate: 0.0025 }), // 250
      market({ total_volume_usd: 40_000, creator_reward_rate: 0.005 }), // 200
      market({ total_volume_usd: '20000', creator_reward_rate: '0.0035' }), // 70 (string numerics)
    ]
    expect(accruedRewardUsd(markets)).toBeCloseTo(520, 6)
  })

  it('treats a missing rate as zero accrual (never invents a rate)', () => {
    expect(marketAccruedRewardUsd(market({ total_volume_usd: 500_000, creator_reward_rate: null }))).toBe(0)
  })

  it('returns 0 for an empty portfolio', () => {
    expect(accruedRewardUsd([])).toBe(0)
  })
})

describe('paid reward (creator_reward ledger) — completed only', () => {
  it('sums only completed rows, ignoring pending/failed', () => {
    const txns = [
      txn({ amount_usd: 100, status: 'completed' }),
      txn({ amount_usd: 50, status: 'completed' }),
      txn({ amount_usd: 999, status: 'pending' }),
      txn({ amount_usd: 999, status: 'failed' }),
    ]
    expect(paidRewardUsd(txns)).toBe(150)
  })

  it('returns 0 when there are no reward transactions', () => {
    expect(paidRewardUsd([])).toBe(0)
  })
})

describe('volume + status aggregation', () => {
  it('sums total volume across markets tolerating string numerics', () => {
    expect(totalVolumeUsd([market({ total_volume_usd: '100.5' }), market({ total_volume_usd: 200 })])).toBeCloseTo(300.5, 6)
  })

  it('counts markets by status', () => {
    const markets = [
      market({ status: 'active' }),
      market({ status: 'active' }),
      market({ status: 'pending' }),
      market({ status: 'draft' }),
      market({ status: 'resolved' }),
    ]
    expect(countByStatus(markets)).toEqual({ active: 2, pending: 1, draft: 1, resolved: 1 })
  })
})

describe('rewardByMonth()', () => {
  it('buckets completed payouts by UTC month, ascending, ignoring non-completed', () => {
    const txns = [
      txn({ amount_usd: 10, created_at: '2026-01-15T10:00:00Z' }),
      txn({ amount_usd: 20, created_at: '2026-01-20T10:00:00Z' }),
      txn({ amount_usd: 30, created_at: '2026-03-01T10:00:00Z' }),
      txn({ amount_usd: 999, status: 'pending', created_at: '2026-02-01T10:00:00Z' }),
    ]
    expect(rewardByMonth(txns)).toEqual([
      { month: '2026-01', usd: 30, count: 2 },
      { month: '2026-03', usd: 30, count: 1 },
    ])
  })

  it('skips rows with an invalid timestamp', () => {
    expect(rewardByMonth([txn({ amount_usd: 5, created_at: 'not-a-date' })])).toEqual([])
  })
})

describe('summarizeCreatorOverview()', () => {
  it('rolls up counts, volume, bettors, paid + accrued reward', () => {
    const markets = [
      market({ status: 'active', total_volume_usd: 1_000_000, creator_reward_rate: 0.0025, unique_bettors: 120 }),
      market({ status: 'pending', total_volume_usd: 0, creator_reward_rate: 0.0025, unique_bettors: 0 }),
      market({ status: 'draft', total_volume_usd: 0, creator_reward_rate: 0.0025, unique_bettors: 0 }),
      market({ status: 'resolved', total_volume_usd: 500_000, creator_reward_rate: 0.0025, unique_bettors: 80 }),
      market({ status: 'closed', total_volume_usd: 0, creator_reward_rate: 0.0025, unique_bettors: 0 }),
    ]
    const txns = [txn({ amount_usd: 1250, status: 'completed' })]
    const s = summarizeCreatorOverview(markets, txns)
    expect(s.totalMarkets).toBe(5)
    expect(s.activeMarkets).toBe(1)
    expect(s.pendingMarkets).toBe(1)
    expect(s.draftMarkets).toBe(1)
    expect(s.resolvedMarkets).toBe(2) // resolved + closed
    expect(s.totalVolumeUsd).toBe(1_500_000)
    expect(s.totalBettors).toBe(200)
    expect(s.paidRewardUsd).toBe(1250)
    // 1.5M volume × 0.0025 = 3750
    expect(s.accruedRewardUsd).toBeCloseTo(3750, 6)
  })

  it('is safe on an empty portfolio', () => {
    const s = summarizeCreatorOverview([], [])
    expect(s).toMatchObject({ totalMarkets: 0, activeMarkets: 0, totalVolumeUsd: 0, accruedRewardUsd: 0, paidRewardUsd: 0 })
  })
})
