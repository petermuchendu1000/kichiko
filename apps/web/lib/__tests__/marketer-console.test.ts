import { describe, it, expect } from 'vitest'
import {
  toNum,
  round2,
  isActiveReferral,
  summarizeReferrals,
  isPaidCommission,
  summarizeCommissions,
  groupPayoutsByRun,
  summarizeRedemptions,
  redemptionsByCampaign,
  type ReferralRow,
  type PayoutItemRow,
  type RedemptionRow,
} from '@/lib/marketer/console'

describe('toNum', () => {
  it('coerces numeric strings (Postgres NUMERIC) and nullish to 0', () => {
    expect(toNum('12.34')).toBe(12.34)
    expect(toNum(5)).toBe(5)
    expect(toNum(null)).toBe(0)
    expect(toNum(undefined)).toBe(0)
    expect(toNum('nope')).toBe(0)
  })
})

describe('round2', () => {
  it('rounds to cents and clears float drift', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3) // 0.30000000000000004 -> 0.3
    expect(round2(1.014)).toBe(1.01)
    expect(round2(1.016)).toBe(1.02)
    expect(round2(-1.016)).toBe(-1.02)
    expect(round2(10.5 + 4.5)).toBe(15)
  })
})

describe('isActiveReferral', () => {
  it('is active for qualified-like statuses', () => {
    for (const status of ['qualified', 'active', 'converted', 'rewarded', 'paid', 'COMPLETED']) {
      expect(isActiveReferral({ status, qualified_at: null })).toBe(true)
    }
  })
  it('is active when qualified_at is set regardless of status', () => {
    expect(isActiveReferral({ status: 'pending', qualified_at: '2026-01-01T00:00:00Z' })).toBe(true)
  })
  it('is inactive for pending / null with no qualified_at', () => {
    expect(isActiveReferral({ status: 'pending', qualified_at: null })).toBe(false)
    expect(isActiveReferral({ status: null, qualified_at: null })).toBe(false)
  })
})

describe('summarizeReferrals', () => {
  it('counts total / active / pending', () => {
    const rows: ReferralRow[] = [
      { status: 'qualified', qualified_at: null, created_at: '2026-01-01' },
      { status: 'pending', qualified_at: null, created_at: '2026-01-02' },
      { status: 'pending', qualified_at: '2026-01-03', created_at: '2026-01-03' },
    ]
    expect(summarizeReferrals(rows)).toEqual({ total: 3, active: 2, pending: 1 })
  })
  it('handles empty input', () => {
    expect(summarizeReferrals([])).toEqual({ total: 0, active: 0, pending: 0 })
  })
})

describe('isPaidCommission', () => {
  it('recognises disbursed-money statuses only', () => {
    for (const s of ['paid', 'disbursed', 'settled', 'sent', 'PAID']) expect(isPaidCommission(s)).toBe(true)
    for (const s of ['pending', 'eligible', 'approved', 'held', null, undefined]) expect(isPaidCommission(s)).toBe(false)
  })
})

describe('summarizeCommissions', () => {
  it('splits paid vs pending in USD and never double counts', () => {
    const rows: PayoutItemRow[] = [
      { run_id: 'r1', amount_usd: '10.50', status: 'paid', created_at: '2026-01-01' },
      { run_id: 'r1', amount_usd: 4.5, status: 'pending', created_at: '2026-01-02' },
      { run_id: 'r2', amount_usd: '2', status: 'eligible', created_at: '2026-01-03' },
    ]
    expect(summarizeCommissions(rows)).toEqual({ paidUsd: 10.5, pendingUsd: 6.5, totalUsd: 17, count: 3 })
  })
  it('handles empty input', () => {
    expect(summarizeCommissions([])).toEqual({ paidUsd: 0, pendingUsd: 0, totalUsd: 0, count: 0 })
  })
})

describe('groupPayoutsByRun', () => {
  const rows: PayoutItemRow[] = [
    { run_id: 'run-b', amount_usd: '10', status: 'paid', created_at: '2026-02-01' },
    { run_id: 'run-b', amount_usd: '5', status: 'pending', created_at: '2026-02-02' },
    { run_id: 'run-a', amount_usd: '3', status: 'paid', created_at: '2026-01-01' },
    { run_id: null, amount_usd: '1', status: 'pending', created_at: '2026-03-01' },
  ]
  it('groups by run with per-run totals and status sets', () => {
    const groups = groupPayoutsByRun(rows)
    const byId = Object.fromEntries(groups.map((g) => [g.runId ?? 'null', g]))
    expect(byId['run-b']).toMatchObject({ count: 2, totalUsd: 15, paidUsd: 10, pendingUsd: 5, statuses: ['paid', 'pending'] })
    expect(byId['run-a']).toMatchObject({ count: 1, totalUsd: 3, paidUsd: 3, pendingUsd: 0 })
    expect(byId['null']).toMatchObject({ runId: null, count: 1, totalUsd: 1, pendingUsd: 1 })
  })
  it('sorts most-recent activity first', () => {
    const groups = groupPayoutsByRun(rows)
    expect(groups[0].runId).toBeNull() // 2026-03-01 is latest
    expect(groups.map((g) => g.runId)).toEqual([null, 'run-b', 'run-a'])
  })
})

describe('redemptions', () => {
  const rows: RedemptionRow[] = [
    { campaign_id: 'c1', amount_usd: '2.5', created_at: '2026-01-01' },
    { campaign_id: 'c1', amount_usd: 2.5, created_at: '2026-01-02' },
    { campaign_id: 'c2', amount_usd: '1', created_at: '2026-01-03' },
  ]
  it('summarizes count + total USD', () => {
    expect(summarizeRedemptions(rows)).toEqual({ count: 3, totalUsd: 6 })
  })
  it('aggregates per campaign', () => {
    const by = redemptionsByCampaign(rows)
    expect(by.c1).toEqual({ count: 2, totalUsd: 5 })
    expect(by.c2).toEqual({ count: 1, totalUsd: 1 })
  })
})
