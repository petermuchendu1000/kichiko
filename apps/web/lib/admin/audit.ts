// lib/admin/audit.ts — Centralized audit-log writer for admin actions.
//
// Every mutating admin action MUST call writeAudit(). It records who did what,
// to which entity, with before/after snapshots and request context (IP, UA).
// Writes use the service-role client so the row is always recorded regardless
// of the caller's RLS scope; reads are gated by the `audit:read` capability.
import { trustedClientIp } from '@/lib/security/client-ip'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

export interface AuditEntry {
  /** The staff member performing the action (profiles.id / auth uid). */
  actorId: string
  /** Machine action name, e.g. 'user.role_grant', 'gateway.rotate_secret'. */
  action: string
  /** Logical entity type, e.g. 'profile', 'market', 'payment_gateway'. */
  entityType?: string
  /** Affected entity id (UUID) when applicable. */
  entityId?: string | null
  /** State before the change (redact secrets before passing in). */
  oldData?: Record<string, unknown> | null
  /** State after the change (redact secrets before passing in). */
  newData?: Record<string, unknown> | null
  /** Request IP (the trusted client IP, lib/security/client-ip). */
  ipAddress?: string | null
  /** Request user-agent. */
  userAgent?: string | null
}

/**
 * Persist an audit entry. Never throws into the caller's happy path — audit
 * failures are logged but must not break the operator action they describe
 * (the action itself is the source of truth; we still surface the error).
 */
export async function writeAudit(
  supabase: SupabaseClient<Database>,
  entry: AuditEntry
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('audit_log').insert({
    actor_id: entry.actorId,
    action: entry.action,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
    old_data: (entry.oldData ?? null) as Database['public']['Tables']['audit_log']['Insert']['old_data'],
    new_data: (entry.newData ?? null) as Database['public']['Tables']['audit_log']['Insert']['new_data'],
    ip_address: entry.ipAddress ?? null,
    user_agent: entry.userAgent ?? null,
  })
  if (error) {
    console.error('[audit] failed to write audit entry', entry.action, error.message)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/** Extract client IP + UA from Next.js request headers for an audit entry. */
export function requestContext(headers: Headers): {
  ipAddress: string | null
  userAgent: string | null
} {
  // the trusted client IP (audit 6.9), not the client-written first XFF entry
  const ipAddress = trustedClientIp(headers)
  return { ipAddress: ipAddress || null, userAgent: headers.get('user-agent') }
}

// ============================================================
// Audit & Security console — read model (pure param parsing + server fetch).
// The audit_log SELECT is gated by RLS (`audit:read`, migration 009); this
// layer just parses filters and resolves actor display names.
// ============================================================

export const AUDIT_DEFAULT_PAGE_SIZE = 50
export const AUDIT_MAX_PAGE_SIZE = 500

export interface AuditListParams {
  actor: string | null // profile id (UUID)
  entityType: string | null
  entityId: string | null // UUID
  action: string | null // substring match on the machine action name
  from: string | null // ISO date (YYYY-MM-DD)
  to: string | null
  page: number
  pageSize: number
  offset?: number // exports: an explicit row offset (overrides page)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Parse & bound audit-console query params (pure — unit-tested). */
export function parseAuditParams(
  sp: Record<string, string | string[] | undefined> | URLSearchParams
): AuditListParams {
  const get = (k: string): string | null => {
    if (sp instanceof URLSearchParams) return sp.get(k)
    const v = sp[k]
    return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
  }
  const page = Math.max(1, parseInt(get('page') ?? '1', 10) || 1)
  const rawSize = parseInt(get('pageSize') ?? String(AUDIT_DEFAULT_PAGE_SIZE), 10) || AUDIT_DEFAULT_PAGE_SIZE
  const pageSize = Math.min(AUDIT_MAX_PAGE_SIZE, Math.max(1, rawSize))
  const uuidOrNull = (v: string | null) => (v && UUID_RE.test(v) ? v : null)
  const dateOrNull = (v: string | null) => (v && DATE_RE.test(v) ? v : null)
  return {
    actor: uuidOrNull(get('actor')),
    entityType: (get('entityType') ?? '').trim() || null,
    entityId: uuidOrNull(get('entityId')),
    action: (get('action') ?? '').trim() || null,
    from: dateOrNull(get('from')),
    to: dateOrNull(get('to')),
    page,
    pageSize,
  }
}

type AuditRow = Database['public']['Tables']['audit_log']['Row']
export interface AuditRowWithActor extends AuditRow {
  actor?: { username: string | null; display_name: string | null } | null
}

/** Fetch a filtered, paginated page of the audit log + total (RLS-enforced). */
export async function fetchAuditLog(
  supabase: SupabaseClient<Database>,
  params: AuditListParams
): Promise<{ rows: AuditRowWithActor[]; total: number; error?: string }> {
  const from = params.offset ?? (params.page - 1) * params.pageSize
  let query = supabase
    .from('audit_log')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false }) // id: stable pages
    .range(from, from + params.pageSize - 1)

  if (params.actor) query = query.eq('actor_id', params.actor)
  if (params.entityType) query = query.eq('entity_type', params.entityType)
  if (params.entityId) query = query.eq('entity_id', params.entityId)
  if (params.action) query = query.ilike('action', `%${params.action}%`)
  if (params.from) query = query.gte('created_at', `${params.from}T00:00:00Z`)
  if (params.to) query = query.lte('created_at', `${params.to}T23:59:59Z`)

  const { data, count, error } = await query
  const rows = (data ?? []) as AuditRow[]
  const actorIds = Array.from(new Set(rows.map((r) => r.actor_id).filter(Boolean))) as string[]
  const actors: Record<string, { username: string | null; display_name: string | null }> = {}
  if (actorIds.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, username, display_name')
      .in('id', actorIds)
    for (const p of profs ?? []) actors[p.id] = { username: p.username, display_name: p.display_name }
  }
  return {
    rows: rows.map((r) => ({ ...r, actor: r.actor_id ? actors[r.actor_id] ?? null : null })),
    total: count ?? 0,
    error: error?.message,
  }
}

/** Security-relevant actions to surface on the security tab (prefix match). */
export const SECURITY_ACTION_PREFIXES = [
  'user.role_grant',
  'user.set_role',
  'user.impersonate',
  'user.set_status',
  'gateway.rotate_secret',
  'gateway.clear_secret',
  'moderation.',
  'announcement.',
] as const

export function isSecurityAction(action: string): boolean {
  return SECURITY_ACTION_PREFIXES.some((p) => action.startsWith(p))
}

/** Redact known-sensitive keys from an object before it enters the audit log. */
export function redact<T extends Record<string, unknown>>(
  obj: T,
  sensitiveKeys: string[] = [
    'consumer_secret',
    'passkey',
    'security_credential',
    'api_key',
    'client_secret',
    'pin',
    'password',
    'secret',
    'secret_ref',
  ]
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    out[k] = sensitiveKeys.some((s) => k.toLowerCase().includes(s)) ? '***redacted***' : v
  }
  return out
}
