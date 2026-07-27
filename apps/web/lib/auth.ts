// lib/auth.ts — Centralized authentication & RBAC helpers (server-side).
//
// One place to resolve the current user + profile and enforce roles, so
// route handlers and server components don't re-implement auth checks.
import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type { Enums } from '@/types/supabase'
import {
  type Capability,
  canAccessAdminPortal,
  canGrantRole,
  roleHasCapability,
} from '@/lib/admin/rbac'

export type Role = Enums<'user_role'>
export type { Capability }

/**
 * Roles allowed to access the admin dashboard / management actions.
 * Includes superadmin (god-mode) and moderator; kept for back-compat with
 * callers that use requireRole(ADMIN_ROLES). Prefer requireCapability().
 */
export const ADMIN_ROLES: Role[] = ['admin', 'moderator', 'superadmin']
/** Roles allowed to resolve markets. */
export const RESOLVER_ROLES: Role[] = ['admin', 'moderator', 'resolver', 'superadmin']

/** Pure, testable role check. */
export function hasRole(role: Role | null | undefined, allowed: Role[]): boolean {
  return role != null && allowed.includes(role)
}

export interface AuthContext {
  user: User
  role: Role
  accountStatus: Enums<'account_status'>
  kycStatus: Enums<'kyc_status'>
  // The request-scoped Supabase client (RLS-enforced, user session).
  supabase: Awaited<ReturnType<typeof createClient>>
}

/**
 * Resolve the current user and their profile fields.
 * Returns null when unauthenticated.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return null

  // Self-scoped read: get_my_profile() returns only the caller's own row.
  const { data: profile } = await supabase.rpc('get_my_profile').maybeSingle()

  return {
    user,
    supabase,
    role: (profile?.role ?? 'user') as Role,
    accountStatus: (profile?.account_status ?? 'active') as Enums<'account_status'>,
    kycStatus: (profile?.kyc_status ?? 'unverified') as Enums<'kyc_status'>,
  }
}

/** Discriminated result used by route guards. */
export type GuardResult =
  | { ok: true; ctx: AuthContext }
  | { ok: false; response: NextResponse }

const err = (status: number, error: string, extra?: Record<string, unknown>) => ({
  ok: false as const,
  response: NextResponse.json({ error, ...extra }, { status }),
})

/** Require an authenticated, active user. */
export async function requireUser(): Promise<GuardResult> {
  const ctx = await getAuthContext()
  if (!ctx) return err(401, 'Unauthorized')
  if (ctx.accountStatus !== 'active') return err(403, 'Account is not active')
  return { ok: true, ctx }
}

/** Require an authenticated, active user with one of the allowed roles. */
export async function requireRole(allowed: Role[]): Promise<GuardResult> {
  const guard = await requireUser()
  if (!guard.ok) return guard
  if (!hasRole(guard.ctx.role, allowed)) {
    return err(403, 'Insufficient permissions')
  }
  return guard
}

// ------------------------------------------------------------
// Capability-based guards (admin control plane)
// ------------------------------------------------------------

/** Pure capability check for an already-resolved context. */
export function hasCapability(ctx: AuthContext, cap: Capability): boolean {
  return roleHasCapability(ctx.role, cap)
}

/**
 * Require an authenticated, active user who holds `cap`. This is the preferred
 * guard for every admin route handler. RLS + DB triggers remain the final
 * backstop; this returns a clean 401/403 before the query runs.
 */
export async function requireCapability(cap: Capability): Promise<GuardResult> {
  const guard = await requireUser()
  if (!guard.ok) return guard
  if (!hasCapability(guard.ctx, cap)) {
    return err(403, 'Insufficient permissions', { capability: cap })
  }
  return guard
}

/** Require the user to be able to load the /admin portal (staff or resolver). */
export async function requireAdminPortal(): Promise<GuardResult> {
  const guard = await requireUser()
  if (!guard.ok) return guard
  if (!canAccessAdminPortal(guard.ctx.role)) {
    return err(403, 'Insufficient permissions')
  }
  return guard
}

/**
 * Application-layer guardrail used before performing a role grant. Enforces the
 * superadmin-only rule for staff roles and the no-touching-a-superadmin
 * immutability rule. DB triggers (migration 009) are the ultimate backstop.
 */
export function requireStaffRoleGrant(
  actorRole: Role,
  targetCurrentRole: Role,
  newRole: Role
): { ok: true } | { ok: false; reason: string } {
  if (targetCurrentRole === 'superadmin') {
    return { ok: false, reason: 'A superadmin is immutable and cannot be changed.' }
  }
  if (!canGrantRole(actorRole, newRole)) {
    return {
      ok: false,
      reason:
        newRole === 'superadmin' || ['support', 'finance', 'moderator', 'admin'].includes(newRole)
          ? 'Only a superadmin can grant staff roles.'
          : 'You do not have permission to grant this role.',
    }
  }
  return { ok: true }
}
