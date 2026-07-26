// lib/tier.ts
// ------------------------------------------------------------
// Trader tier ladder — parity with the 7-step Taker Rebate program used to
// rank/decorate public profiles. A trader's tier is derived from 30-day
// weighted volume (wV). Thresholds, rebate %, and one-time level-up bonuses are
// the published program values; the gradient colours mirror the on-profile
// badge tints (Gold/Diamond/Obsidian captured from the live badges; Bronze/
// Silver/Platinum use palette-consistent metallic ramps for the tiers that
// don't appear on the public leaderboard).
//
// The BADGE ARTWORK itself is Kichiko' own medal design (components/ui/
// tier-badge.tsx) — only the factual ladder + tint system live here.

export type TierKey =
  | 'none' | 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond' | 'obsidian'

export interface Tier {
  key: TierKey
  /** Program tier number (0 = below Bronze). */
  level: number
  label: string
  /** Minimum 30-day weighted volume (USD) to hold this tier. */
  minVolume: number
  /** Daily taker-fee rebate at this tier. */
  rebatePct: number
  /** One-time bonus (USD) the first time you reach this tier. */
  levelUpBonus: number
  /** Badge gradient stops [from, to]. */
  gradient: [string, string]
  /** Emblem/foreground colour that reads on the gradient. */
  ink: string
}

export const TIERS: Tier[] = [
  { key: 'none',     level: 0, label: 'Unranked', minVolume: 0,         rebatePct: 0,  levelUpBonus: 0,     gradient: ['#C2C8D0', '#98A0AC'], ink: '#5F6772' },
  { key: 'bronze',   level: 1, label: 'Bronze',   minVolume: 2_000,     rebatePct: 3,  levelUpBonus: 10,    gradient: ['#E3A76A', '#B87333'], ink: '#5A3411' },
  { key: 'silver',   level: 2, label: 'Silver',   minVolume: 20_000,    rebatePct: 8,  levelUpBonus: 50,    gradient: ['#E7EBF0', '#A8B2BE'], ink: '#4A525C' },
  { key: 'gold',     level: 3, label: 'Gold',     minVolume: 200_000,   rebatePct: 18, levelUpBonus: 250,   gradient: ['#FCC533', '#D48A0F'], ink: '#6B4405' },
  { key: 'platinum', level: 4, label: 'Platinum', minVolume: 1_000_000, rebatePct: 32, levelUpBonus: 1_500, gradient: ['#E9EEF3', '#AEBDCB'], ink: '#465562' },
  { key: 'diamond',  level: 5, label: 'Diamond',  minVolume: 4_000_000, rebatePct: 44, levelUpBonus: 7_500, gradient: ['#72D8EA', '#0ACCEE'], ink: '#065A6B' },
  { key: 'obsidian', level: 6, label: 'Obsidian', minVolume: 10_000_000, rebatePct: 50, levelUpBonus: 25_000, gradient: ['#414350', '#1C1C20'], ink: '#C9CDD6' },
]

const BY_KEY: Record<TierKey, Tier> = TIERS.reduce((m, t) => { m[t.key] = t; return m }, {} as Record<TierKey, Tier>)

/** Resolve the tier for a 30-day weighted volume (USD). */
export function tierForVolume(weightedVolumeUsd: number | null | undefined): Tier {
  const v = Number(weightedVolumeUsd) || 0
  let current = TIERS[0]
  for (const t of TIERS) if (v >= t.minVolume) current = t
  return current
}

export function tierByKey(key: TierKey): Tier {
  return BY_KEY[key] ?? TIERS[0]
}

/** Progress (0..1) toward the next tier, plus the next tier (null at top). */
export function tierProgress(weightedVolumeUsd: number): { pct: number; next: Tier | null } {
  const v = Number(weightedVolumeUsd) || 0
  const cur = tierForVolume(v)
  const next = TIERS.find((t) => t.level === cur.level + 1) ?? null
  if (!next) return { pct: 1, next: null }
  const span = next.minVolume - cur.minVolume || 1
  return { pct: Math.min(1, Math.max(0, (v - cur.minVolume) / span)), next }
}
