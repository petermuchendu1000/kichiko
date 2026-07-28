// lib/creator/guard.ts — Server-component guard for the self-service creator console.
//
// Mirrors lib/admin/page-guard.ts (requirePageCapability) but for the USER-facing
// creator console at /creator. A creator authors prediction markets, so they are
// an ELEVATED_USER_ROLE (see lib/admin/rbac.ts), NOT admin staff. Access is granted
// to role 'creator' plus the elevated staff roles 'admin' and 'superadmin' (which
// hold every capability, god-mode included). Everyone else is redirected home.
//
// RLS remains the final backstop: every read in the console runs through the
// request-scoped, session-bound Supabase client (ctx.supabase), so a creator can
// only ever see their own creator_profiles row, their own markets, and their own
// creator_reward transactions. This guard returns a clean redirect BEFORE any query
// runs, and hands back the resolved context so pages can render role-aware data.
import { redirect } from 'next/navigation'
import { getAuthContext, type AuthContext, type Role } from '@/lib/auth'

/** Roles allowed to load the creator console. */
export const CREATOR_CONSOLE_ROLES: readonly Role[] = ['creator', 'admin', 'superadmin'] as const

/** Pure, testable check: may this role open the creator console? */
export function canAccessCreatorConsole(role: Role | null | undefined): boolean {
  return role != null && CREATOR_CONSOLE_ROLES.includes(role)
}

/**
 * Require an authenticated user who may access the creator console.
 * Redirects unauthenticated users to sign-in (with a return path) and any
 * non-creator to the site root. Returns the resolved auth context on success.
 */
export async function requireCreator(): Promise<AuthContext> {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/auth/login?next=/creator')
  if (ctx.accountStatus !== 'active') redirect('/')
  if (!canAccessCreatorConsole(ctx.role)) redirect('/')
  return ctx
}
