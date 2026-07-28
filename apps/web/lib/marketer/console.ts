// lib/marketer/console.ts — Marketer self-service console model (pure logic).
//
// PURE + TESTABLE. Every function here operates in the canonical USD unit that
// the database stores (*_usd columns) and returns USD numbers. Currency display
// (USD → KES at the LIVE exchange_rates rate) is done ONLY at the view layer via
// lib/admin/money.ts (kes/kes2) threaded with a rates map from buildRatesMap.
// There is NO currency conversion, rate, or KES peg anywhere in this module.
//
// Aggregations mirror the shape of the DB rows exactly so the console never
// diverges from what RLS returns for the signed-in marketer.

/** Coerce a Postgres NUMERIC (string | number | null) to a finite number. */
export function toNum(v: number | string | null | undefined): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

/** Round to 2 dp (cents) half-away-from-zero — for USD sub-totals. */
export function round2(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n) * 100) / 100
}

// ---- Referrals --------------------------------------------------------------

export interface ReferralRow {
  status: string | null
  qualified_at: string | null
  created_at: string
}

/**
 * A referral counts as "active" once it has converted/qualified — either via an
 * explicit qualified-like status or a populated qualified_at timestamp. This is
 * intentionally tolerant of the exact status vocabulary the pipeline uses.
 */
const ACTIVE_REFERRAL_STATUSES = new Set([
  'qualified', 'active', 'converted', 'rewarded', 'paid', 'completed',
])

export function isActiveReferral(r: Pick<ReferralRow, 'status' | 'qualified_at'>): boolean {
  const s = (r.status ?? '').toLowerCase()
  if (ACTIVE_REFERRAL_STATUSES.has(s)) return true
  return r.qualified_at != null
}

export interface ReferralSummary {
  total: number
  active: number
  pending: number
}

export function summarizeReferrals(rows: ReferralRow[]): ReferralSummary {
  const total = rows.length
  const active = rows.filter(isActiveReferral).length
  return { total, active, pending: total - active }
}

// ---- Commissions (payout_items) ---------------------------------------------

export interface PayoutItemRow {
  run_id: string | null
  amount_usd: number | string | null
  status: string | null
  settlement?: string | null
  eligible_at?: string | null
  created_at: string
}

/** Statuses that mean the money has actually reached the marketer. */
const PAID_STATUSES = new Set(['paid', 'disbursed', 'settled', 'sent'])

export function isPaidCommission(status: string | null | undefined): boolean {
  return PAID_STATUSES.has((status ?? '').toLowerCase())
}

export interface CommissionTotals {
  paidUsd: number
  pendingUsd: number
  totalUsd: number
  count: number
}

/**
 * Split a marketer's payout_items into paid vs still-pending USD totals.
 * Anything not in PAID_STATUSES (pending/eligible/approved/held/…) is treated
 * as outstanding, so a marketer never sees unpaid money reported as paid.
 */
export function summarizeCommissions(rows: PayoutItemRow[]): CommissionTotals {
  let paidUsd = 0
  let pendingUsd = 0
  for (const r of rows) {
    const v = toNum(r.amount_usd)
    if (isPaidCommission(r.status)) paidUsd += v
    else pendingUsd += v
  }
  paidUsd = round2(paidUsd)
  pendingUsd = round2(pendingUsd)
  return { paidUsd, pendingUsd, totalUsd: round2(paidUsd + pendingUsd), count: rows.length }
}

export interface PayoutGroup {
  runId: string | null
  statuses: string[]
  count: number
  totalUsd: number
  paidUsd: number
  pendingUsd: number
  /** Latest created_at across the group's items (ISO string) for sorting/display. */
  latest: string | null
}

/**
 * Group a marketer's payout_items by payout run, aggregating amounts and the
 * set of statuses present in each run. Unassigned items (run_id null — e.g. not
 * yet attached to a run) collapse into a single "unassigned" group. Sorted by
 * most-recent activity first.
 */
export function groupPayoutsByRun(rows: PayoutItemRow[]): PayoutGroup[] {
  const map = new Map<string, PayoutGroup>()
  for (const r of rows) {
    const key = r.run_id ?? '__unassigned__'
    let g = map.get(key)
    if (!g) {
      g = { runId: r.run_id ?? null, statuses: [], count: 0, totalUsd: 0, paidUsd: 0, pendingUsd: 0, latest: null }
      map.set(key, g)
    }
    const v = toNum(r.amount_usd)
    g.count += 1
    g.totalUsd += v
    if (isPaidCommission(r.status)) g.paidUsd += v
    else g.pendingUsd += v
    const s = (r.status ?? '').toLowerCase()
    if (s && !g.statuses.includes(s)) g.statuses.push(s)
    if (r.created_at && (!g.latest || r.created_at > g.latest)) g.latest = r.created_at
  }
  const groups = Array.from(map.values()).map((g) => ({
    ...g,
    totalUsd: round2(g.totalUsd),
    paidUsd: round2(g.paidUsd),
    pendingUsd: round2(g.pendingUsd),
    statuses: g.statuses.sort(),
  }))
  groups.sort((a, b) => (b.latest ?? '').localeCompare(a.latest ?? ''))
  return groups
}

// ---- Campaign redemptions ---------------------------------------------------

export interface RedemptionRow {
  campaign_id: string | null
  amount_usd: number | string | null
  created_at: string
}

export interface RedemptionSummary {
  count: number
  totalUsd: number
}

export function summarizeRedemptions(rows: RedemptionRow[]): RedemptionSummary {
  const totalUsd = round2(rows.reduce((acc, r) => acc + toNum(r.amount_usd), 0))
  return { count: rows.length, totalUsd }
}

/** Sum redemption USD per campaign_id, keyed for quick lookup on the campaigns page. */
export function redemptionsByCampaign(rows: RedemptionRow[]): Record<string, RedemptionSummary> {
  const out: Record<string, RedemptionSummary> = {}
  for (const r of rows) {
    if (!r.campaign_id) continue
    const cur = out[r.campaign_id] ?? { count: 0, totalUsd: 0 }
    cur.count += 1
    cur.totalUsd = round2(cur.totalUsd + toNum(r.amount_usd))
    out[r.campaign_id] = cur
  }
  return out
}
