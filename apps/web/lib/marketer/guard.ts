// lib/marketer/guard.ts — Server-component role guard for the marketer console.
//
// Marketers are affiliate/growth partners: a user-facing ELEVATED role (see
// ELEVATED_USER_ROLES in lib/admin/rbac.ts), NOT internal staff. Their console
// lives at /marketer (its own route group, outside /admin). This guard is the
// per-page defence-in-depth check that mirrors requirePageCapability's shape:
// it resolves the caller once and enforces the allow-list, so every marketer
// page can render role-aware, RLS-scoped data with a single call.
//
// Allow-list: the marketer themselves, plus admin/superadmin for oversight.
// Everyone else (regular users, other elevated/staff roles) is redirected home,
// and unauthenticated callers are sent to login with a return path.
import { redirect } from 'next/navigation'
import { getAuthContext, hasRole, type AuthContext, type Role } from '@/lib/auth'

/**
 * Roles allowed to load the marketer console.
 *   • marketer   — the partner's own self-service console (RLS scopes to them).
 *   • admin      — oversight / support (RLS grants broad marketers:manage read).
 *   • superadmin — god-mode oversight.
 * Kept as a readonly tuple so it can be unit-tested and reused by the nav.
 */
export const MARKETER_CONSOLE_ROLES: readonly Role[] = ['marketer', 'admin', 'superadmin'] as const

/** Pure, testable check: may this role load the marketer console? */
export function canAccessMarketerConsole(role: Role | null | undefined): boolean {
  return hasRole(role, MARKETER_CONSOLE_ROLES as Role[])
}

/**
 * Require the caller to be allowed into the marketer console.
 * Redirects unauthenticated callers to login (with a return path) and
 * disallowed roles to the site root. Returns the resolved, RLS-enforced
 * AuthContext so pages can query the caller's own rows via ctx.supabase.
 */
export async function requireMarketer(): Promise<AuthContext> {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/auth/login?next=/marketer')
  if (!canAccessMarketerConsole(ctx.role)) redirect('/')
  return ctx
}
