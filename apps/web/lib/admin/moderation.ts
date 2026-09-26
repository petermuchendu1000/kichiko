// lib/admin/moderation.ts — Content-moderation console model (pure + server helpers).
//
// Pure cores (report triage, SLA math, param parsing, labels) are unit-tested
// and mirror migration 014. Server helpers resolve reporter/handler display
// names via a secondary `.in()` lookup so we avoid typed embedded-join friction
// while staying RLS-enforced. Mirrors lib/admin/finance & lib/admin/creators.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

// ---- Domain constants (lockstep with migration 014 CHECK constraints) -------
export const REPORT_ENTITY_TYPES = ['market', 'comment', 'profile'] as const
export type ReportEntityType = (typeof REPORT_ENTITY_TYPES)[number]

export const REPORT_REASONS = [
  'spam',
  'abuse',
  'harassment',
  'fraud',
  'illegal',
  'misinformation',
  'other',
] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

export const REPORT_STATUSES = ['open', 'reviewing', 'actioned', 'dismissed'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

export const MODERATION_ACTIONS = ['take_down', 'restore'] as const
export type ModerationAction = (typeof MODERATION_ACTIONS)[number]

/** Statuses that still count as an open workload (SLA applies). */
export const ACTIVE_REPORT_STATUSES: readonly ReportStatus[] = ['open', 'reviewing'] as const

// ---- SLA policy (business logic) --------------------------------------------
// Response-time targets in HOURS by severity. Illegal content is fastest.
export const SLA_HOURS: Record<ReportReason, number> = {
  illegal: 4,
  fraud: 8,
  harassment: 12,
  abuse: 12,
  misinformation: 24,
  spam: 48,
  other: 48,
}

export function slaHoursFor(reason: string): number {
  return (SLA_HOURS as Record<string, number>)[reason] ?? SLA_HOURS.other
}

/** Age of a report in hours (fractional), clamped at ≥ 0. */
export function reportAgeHours(createdAt: string, now: number = Date.now()): number {
  const t = new Date(createdAt).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, (now - t) / 3_600_000)
}

/** When this report's SLA elapses. */
export function slaDueAt(createdAt: string, reason: string): Date {
  return new Date(new Date(createdAt).getTime() + slaHoursFor(reason) * 3_600_000)
}

/** Is an unresolved report past its SLA? Resolved reports are never overdue. */
export function isOverdue(
  report: { reason: string; status: string; created_at: string },
  now: number = Date.now()
): boolean {
  if (!(ACTIVE_REPORT_STATUSES as readonly string[]).includes(report.status)) return false
  return reportAgeHours(report.created_at, now) > slaHoursFor(report.reason)
}

// ---- Labels (UI) ------------------------------------------------------------
const ENTITY_LABELS: Record<ReportEntityType, string> = {
  market: 'Market',
  comment: 'Comment',
  profile: 'Profile',
}
export function entityLabel(t: string): string {
  return (ENTITY_LABELS as Record<string, string>)[t] ?? t
}

export function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}
export const reasonLabel = titleCase
export const statusLabel = titleCase

/** Deep-link to the reported entity for the moderator to inspect. */
export function entityHref(entityType: string, entityId: string): string {
  switch (entityType) {
    case 'market':
      return `/markets/${entityId}`
    case 'profile':
      return `/admin/users/${entityId}`
    default:
      return `/admin/moderation` // comments have no standalone page
  }
}

// ---- List params ------------------------------------------------------------
export const DEFAULT_PAGE_SIZE = 25
export const MAX_PAGE_SIZE = 200

export interface ReportListParams {
  status: ReportStatus | null
  entity_type: ReportEntityType | null
  reason: ReportReason | null
  q: string | null
  page: number
  pageSize: number
  offset?: number // exports: an explicit row offset (overrides page)
}

function reader(
  sp: Record<string, string | string[] | undefined> | URLSearchParams
): (k: string) => string | null {
  return (k: string) => {
    if (sp instanceof URLSearchParams) return sp.get(k)
    const v = sp[k]
    return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
  }
}

function oneOf<T extends string>(v: string | null, allowed: readonly string[]): T | null {
  return v && allowed.includes(v) ? (v as T) : null
}

export function parseReportListParams(
  sp: Record<string, string | string[] | undefined> | URLSearchParams
): ReportListParams {
  const get = reader(sp)
  const page = Math.max(1, parseInt(get('page') ?? '1', 10) || 1)
  const rawSize = parseInt(get('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, rawSize))
  return {
    status: oneOf<ReportStatus>(get('status'), REPORT_STATUSES),
    entity_type: oneOf<ReportEntityType>(get('entity_type'), REPORT_ENTITY_TYPES),
    reason: oneOf<ReportReason>(get('reason'), REPORT_REASONS),
    q: (get('q') ?? '').trim() || null,
    page,
    pageSize,
  }
}

// ---- Server helpers ---------------------------------------------------------
type ReportRow = Database['public']['Tables']['content_reports']['Row']
export interface ReportWithReporter extends ReportRow {
  reporter?: { username: string | null; display_name: string | null } | null
}

/** Fetch a filtered, paginated page of reports + total count (RLS-enforced). */
export async function fetchReports(
  supabase: SupabaseClient<Database>,
  params: ReportListParams
): Promise<{ rows: ReportWithReporter[]; total: number; error?: string }> {
  const from = params.offset ?? (params.page - 1) * params.pageSize
  let query = supabase
    .from('content_reports')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false }) // id: stable pages
    .range(from, from + params.pageSize - 1)

  if (params.status) query = query.eq('status', params.status)
  if (params.entity_type) query = query.eq('entity_type', params.entity_type)
  if (params.reason) query = query.eq('reason', params.reason)
  if (params.q) query = query.or(`entity_id.eq.${params.q},details.ilike.%${params.q}%`)

  const { data, count, error } = await query
  const rows = (data ?? []) as ReportRow[]
  const reporterIds = Array.from(new Set(rows.map((r) => r.reporter_id).filter(Boolean))) as string[]
  const reporters = await resolveProfiles(supabase, reporterIds)
  return {
    rows: rows.map((r) => ({ ...r, reporter: r.reporter_id ? reporters[r.reporter_id] ?? null : null })),
    total: count ?? 0,
    error: error?.message,
  }
}

/** Batch-resolve profile display fields for a set of ids. */
export async function resolveProfiles(
  supabase: SupabaseClient<Database>,
  ids: string[]
): Promise<Record<string, { username: string | null; display_name: string | null }>> {
  if (ids.length === 0) return {}
  const { data } = await supabase.from('profiles').select('id, username, display_name').in('id', ids)
  const map: Record<string, { username: string | null; display_name: string | null }> = {}
  for (const p of data ?? []) map[p.id] = { username: p.username, display_name: p.display_name }
  return map
}

/** Count of currently taken-down (hidden) markets — for the console header. */
export async function fetchHiddenMarketCount(
  supabase: SupabaseClient<Database>
): Promise<number> {
  const { count } = await supabase
    .from('markets')
    .select('id', { count: 'exact', head: true })
    .eq('is_hidden', true)
  return count ?? 0
}
