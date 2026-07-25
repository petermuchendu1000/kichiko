import { describe, it, expect } from 'vitest'
import { usdToLocal } from '../currency'
import {
  normalizeMetric,
  normalizePeriod,
  parseLeaderboardParams,
  computeRanks,
  medalFor,
  formatUsd,
  formatSignedUsd,
  formatPct,
  displayName,
  DEFAULT_LEADERBOARD_LIMIT,
  MAX_LEADERBOARD_LIMIT,
  type LeaderboardEntry,
} from '@/lib/leaderboard'

function mk(id: string, over: Partial<LeaderboardEntry>): LeaderboardEntry {
  return {
    id,
    display_name: id,
    username: id.toLowerCase(),
    avatar_url: null,
    total_bets: 1,
    total_wins: 0,
    win_rate: 0,
    profit_loss_usd: 0,
    total_volume_usd: 0,
    ...over,
  }
}

describe('normalizers', () => {
  it('metric', () => {
    expect(normalizeMetric('pnl')).toBe('pnl')
    expect(normalizeMetric('winrate')).toBe('winrate')
    expect(normalizeMetric('bad')).toBe('volume')
    expect(normalizeMetric(null)).toBe('volume')
  })
  it('period', () => {
    expect(normalizePeriod('week')).toBe('week')
    expect(normalizePeriod('month')).toBe('month')
    expect(normalizePeriod('century')).toBe('all')
  })
})

describe('parseLeaderboardParams', () => {
  it('defaults', () => {
    const p = parseLeaderboardParams(new URLSearchParams(''))
    expect(p).toEqual({ metric: 'volume', period: 'all', limit: DEFAULT_LEADERBOARD_LIMIT })
  })
  it('clamps limit', () => {
    expect(parseLeaderboardParams(new URLSearchParams('limit=9999')).limit).toBe(MAX_LEADERBOARD_LIMIT)
    expect(parseLeaderboardParams(new URLSearchParams('limit=0')).limit).toBe(1)
    expect(parseLeaderboardParams(new URLSearchParams('metric=pnl&period=week')).metric).toBe('pnl')
  })
})

describe('computeRanks (leaderboard ranking gate)', () => {
  const rows = [
    mk('A', { total_volume_usd: 1000, win_rate: 0.4, profit_loss_usd: 50 }),
    mk('B', { total_volume_usd: 500, win_rate: 0.8, profit_loss_usd: -20 }),
    mk('C', { total_volume_usd: 2000, win_rate: 0.6, profit_loss_usd: 300 }),
  ]

  it('ranks by volume descending', () => {
    const r = computeRanks(rows, 'volume')
    expect(r.map((x) => x.id)).toEqual(['C', 'A', 'B'])
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3])
  })
  it('ranks by win rate descending', () => {
    const r = computeRanks(rows, 'winrate')
    expect(r.map((x) => x.id)).toEqual(['B', 'C', 'A'])
  })
  it('ranks by pnl descending (incl. negatives)', () => {
    const r = computeRanks(rows, 'pnl')
    expect(r.map((x) => x.id)).toEqual(['C', 'A', 'B'])
  })
  it('applies standard competition ranking with gaps on ties, id tie-break', () => {
    const tied = [
      mk('x2', { total_volume_usd: 100 }),
      mk('x1', { total_volume_usd: 100 }),
      mk('x3', { total_volume_usd: 50 }),
    ]
    const r = computeRanks(tied, 'volume')
    // tie -> both rank 1 (deterministic id order x1 before x2), next gets rank 3
    expect(r.map((x) => [x.id, x.rank])).toEqual([
      ['x1', 1],
      ['x2', 1],
      ['x3', 3],
    ])
  })
  it('does not mutate the input array', () => {
    const copy = [...rows]
    computeRanks(rows, 'volume')
    expect(rows).toEqual(copy)
  })
})

describe('formatters & helpers', () => {
  it('medalFor', () => {
    expect(medalFor(1)).toBe('🥇')
    expect(medalFor(2)).toBe('🥈')
    expect(medalFor(3)).toBe('🥉')
    expect(medalFor(4)).toBeNull()
    expect(medalFor(undefined)).toBeNull()
  })
  it('usd formatters', () => {
    expect(formatUsd(1234.5)).toBe(`KSh ${Math.round(usdToLocal(1234.5, 'KES')).toLocaleString('en-KE')}`)
    expect(formatSignedUsd(50)).toBe(`+KSh ${Math.round(usdToLocal(50, 'KES')).toLocaleString('en-KE')}`)
    expect(formatSignedUsd(-20)).toBe(`-KSh ${Math.round(usdToLocal(20, 'KES')).toLocaleString('en-KE')}`)
  })
  it('percent', () => {
    expect(formatPct(0.6)).toBe('60%')
    expect(formatPct(null)).toBe('0%')
  })
  it('displayName falls back', () => {
    expect(displayName({ display_name: 'Zed', username: 'z' })).toBe('Zed')
    expect(displayName({ display_name: null, username: 'z' })).toBe('z')
    expect(displayName({ display_name: null, username: null })).toBe('Anonymous')
  })
})
