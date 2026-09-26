import { describe, it, expect } from 'vitest'
import {
  parseMarketListParams,
  availableMarketActions,
  DEFAULT_PAGE_SIZE as M_DEFAULT,
  MAX_PAGE_SIZE as M_MAX,
} from '@/lib/admin/markets'
import {
  parsePaymentListParams,
  parseLedgerParams,
  summariseLedger,
  DEFAULT_PAGE_SIZE as F_DEFAULT,
  MAX_PAGE_SIZE as F_MAX,
} from '@/lib/admin/finance'

// ------------------------------------------------------------
// Markets
// ------------------------------------------------------------
describe('parseMarketListParams', () => {
  it('applies safe defaults', () => {
    expect(parseMarketListParams({})).toMatchObject({
      q: null, status: null, category: null, featured: null,
      sort: 'created_at', dir: 'desc', page: 1, pageSize: M_DEFAULT,
    })
  })

  it('whitelists status and category', () => {
    expect(parseMarketListParams({ status: 'pending' }).status).toBe('pending')
    expect(parseMarketListParams({ status: 'hax' }).status).toBeNull()
    expect(parseMarketListParams({ category: 'sports' }).category).toBe('sports')
    expect(parseMarketListParams({ category: 'nope' }).category).toBeNull()
  })

  it('parses tri-state featured', () => {
    expect(parseMarketListParams({ featured: 'true' }).featured).toBe(true)
    expect(parseMarketListParams({ featured: 'false' }).featured).toBe(false)
    expect(parseMarketListParams({ featured: 'meh' }).featured).toBeNull()
  })

  it('whitelists sort, normalizes dir, clamps paging', () => {
    expect(parseMarketListParams({ sort: 'total_volume_usd' }).sort).toBe('total_volume_usd')
    expect(parseMarketListParams({ sort: 'drop' }).sort).toBe('created_at')
    expect(parseMarketListParams({ dir: 'asc' }).dir).toBe('asc')
    expect(parseMarketListParams({ pageSize: '999999' }).pageSize).toBe(M_MAX)
    expect(parseMarketListParams({ page: '-2' }).page).toBe(1)
  })
})

describe('availableMarketActions', () => {
  it('offers approve/reject on draft & pending', () => {
    for (const s of ['draft', 'pending'] as const) {
      const keys = availableMarketActions(s).map((a) => a.key)
      expect(keys).toContain('approve')
      expect(keys).toContain('reject')
      expect(keys).not.toContain('resolve')
    }
  })

  it('offers close/dispute/feature/cancel on active', () => {
    const keys = availableMarketActions('active').map((a) => a.key)
    expect(keys).toEqual(expect.arrayContaining(['close', 'dispute', 'feature', 'cancel']))
    expect(keys).not.toContain('approve')
  })

  it('offers resolve on closed & disputed', () => {
    expect(availableMarketActions('closed').map((a) => a.key)).toContain('resolve')
    expect(availableMarketActions('disputed').map((a) => a.key)).toContain('resolve')
  })

  it('offers nothing on terminal states', () => {
    expect(availableMarketActions('resolved')).toHaveLength(0)
    expect(availableMarketActions('cancelled')).toHaveLength(0)
  })

  it('maps each action to the correct capability', () => {
    const map = Object.fromEntries(availableMarketActions('active').map((a) => [a.key, a.capability]))
    expect(map.close).toBe('markets:approve')
    expect(map.dispute).toBe('markets:resolve')
    expect(map.cancel).toBe('markets:cancel')
    expect(map.void).toBe('markets:cancel')
  })

  it('offers void (conserving settlement at a price) on active, closed and disputed only', () => {
    for (const s of ['active', 'closed', 'disputed'] as const) {
      expect(availableMarketActions(s).map((a) => a.key)).toContain('void')
    }
    for (const s of ['draft', 'pending', 'resolved', 'cancelled'] as const) {
      expect(availableMarketActions(s).map((a) => a.key)).not.toContain('void')
    }
  })
})

// ------------------------------------------------------------
// Finance — payment list params
// ------------------------------------------------------------
describe('parsePaymentListParams', () => {
  it('defaults + whitelists status/provider', () => {
    expect(parsePaymentListParams({})).toMatchObject({
      status: null, provider: null, country: null, q: null, page: 1, pageSize: F_DEFAULT,
    })
    expect(parsePaymentListParams({ status: 'completed' }).status).toBe('completed')
    expect(parsePaymentListParams({ status: 'boom' }).status).toBeNull()
    expect(parsePaymentListParams({ provider: 'mpesa' }).provider).toBe('mpesa')
    expect(parsePaymentListParams({ provider: 'btc' }).provider).toBeNull()
  })

  it('clamps pageSize to MAX', () => {
    expect(parsePaymentListParams({ pageSize: '100000' }).pageSize).toBe(F_MAX)
  })
})

describe('parseLedgerParams', () => {
  it('whitelists type/status and validates ISO dates', () => {
    expect(parseLedgerParams({ type: 'creator_reward' }).type).toBe('creator_reward')
    expect(parseLedgerParams({ type: 'nope' }).type).toBeNull()
    expect(parseLedgerParams({ from: '2026-01-01', to: '2026-02-01' })).toMatchObject({
      from: '2026-01-01', to: '2026-02-01',
    })
    expect(parseLedgerParams({ from: '01/01/2026' }).from).toBeNull()
    expect(parseLedgerParams({ to: 'yesterday' }).to).toBeNull()
  })
})

// ------------------------------------------------------------
// Finance — reconciliation summary
// ------------------------------------------------------------
describe('summariseLedger', () => {
  const rows = [
    { type: 'deposit', status: 'completed', amount_usd: 100 },
    { type: 'deposit', status: 'pending', amount_usd: 50 }, // not completed -> excluded from money
    { type: 'withdrawal', status: 'completed', amount_usd: 40 },
    { type: 'fee', status: 'completed', amount_usd: 2.5 },
    { type: 'creator_reward', status: 'completed', amount_usd: 0.25 },
    { type: 'referral_bonus', status: 'completed', amount_usd: 5 },
  ]

  it('sums only completed money movement', () => {
    const s = summariseLedger(rows)
    expect(s.deposits_usd).toBe(100)
    expect(s.withdrawals_usd).toBe(40)
    expect(s.fees_usd).toBe(2.5)
    expect(s.creator_rewards_usd).toBe(0.25)
    expect(s.referral_bonus_usd).toBe(5)
    expect(s.net_flow_usd).toBe(60) // 100 - 40
  })

  it('counts every row and aggregates by type (incl. non-completed)', () => {
    const s = summariseLedger(rows)
    expect(s.count).toBe(6)
    expect(s.by_type.deposit).toEqual({ count: 2, amount_usd: 150 })
    expect(s.by_type.withdrawal).toEqual({ count: 1, amount_usd: 40 })
  })

  it('is rounding-safe and coerces string amounts', () => {
    const s = summariseLedger([
      { type: 'deposit', status: 'completed', amount_usd: '0.1' },
      { type: 'deposit', status: 'completed', amount_usd: '0.2' },
    ])
    expect(s.deposits_usd).toBe(0.3)
  })

  it('handles empty input', () => {
    const s = summariseLedger([])
    expect(s).toMatchObject({ count: 0, deposits_usd: 0, withdrawals_usd: 0, net_flow_usd: 0 })
  })
})
