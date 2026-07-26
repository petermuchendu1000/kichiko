// ============================================================
// Kichiko — Market lifecycle state machine
// ------------------------------------------------------------
// Mirrors the `market_status` enum and centralizes the rules for which status
// transitions are legal. Routes/admin actions MUST validate through this module
// so the lifecycle is enforced consistently (and auditable) everywhere.
//
//   draft ──submit──▶ pending ──approve──▶ active ──close──▶ closed ──resolve──▶ resolved
//     │                  │                   │                 │
//     └──activate(admin)─┴───────────────────┤                 ├──dispute──▶ disputed ──resolve/cancel
//     └──cancel──────────┴───────────────────┴─────────────────┘ (cancel from most states)
// ============================================================
import type { MarketStatus } from '@/types'

export const MARKET_STATUSES: readonly MarketStatus[] = [
  'draft', 'pending', 'active', 'closed', 'resolved', 'disputed', 'cancelled',
] as const

/** Statuses from which no further transition is allowed. */
export const TERMINAL_STATUSES: ReadonlySet<MarketStatus> = new Set<MarketStatus>([
  'resolved', 'cancelled',
])

/** Allowed target statuses for each source status. */
export const ALLOWED_TRANSITIONS: Record<MarketStatus, readonly MarketStatus[]> = {
  draft: ['pending', 'active', 'cancelled'],
  pending: ['active', 'draft', 'cancelled'],
  active: ['closed', 'cancelled', 'disputed'],
  closed: ['resolved', 'disputed', 'cancelled'],
  disputed: ['resolved', 'cancelled'],
  resolved: [],
  cancelled: [],
}

/** Human-friendly labels for UI. */
export const STATUS_LABELS: Record<MarketStatus, string> = {
  draft: 'Draft',
  pending: 'Pending review',
  active: 'Active',
  closed: 'Closed (awaiting resolution)',
  resolved: 'Resolved',
  disputed: 'Disputed',
  cancelled: 'Cancelled',
}

export function isTerminalStatus(status: MarketStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

/** True if `from → to` is a legal transition (a no-op `from === to` is not a transition). */
export function canTransition(from: MarketStatus, to: MarketStatus): boolean {
  if (from === to) return false
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to)
}

export interface TransitionResult {
  ok: boolean
  error?: string
}

/** Validate a transition, returning a structured result with a reason on failure. */
export function validateTransition(from: MarketStatus, to: MarketStatus): TransitionResult {
  if (!MARKET_STATUSES.includes(to)) return { ok: false, error: `Unknown status: ${to}` }
  if (from === to) return { ok: false, error: `Market is already ${from}` }
  if (isTerminalStatus(from)) return { ok: false, error: `Cannot change a ${from} market` }
  if (!canTransition(from, to)) return { ok: false, error: `Illegal transition: ${from} → ${to}` }
  return { ok: true }
}
