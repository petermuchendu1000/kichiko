// lib/security/route-protection.ts — pure edge auth-gate decisions.
//
// Extracted from middleware.ts so the routing rules that decide "does this
// request need a logged-in user?" are unit-testable in isolation (the
// middleware itself pulls in next/server and a live Supabase client, so it
// can't run under vitest). Keep this file framework-free.
//
// History / regression guard: `/api/markets` used to live in the fully-gated
// list with a "POST only" comment, but the prefix check gated EVERY method —
// so anonymous GETs to the PUBLIC market reads (`/api/markets`,
// `/api/markets/[id]`, `/api/markets/[id]/book`, `/api/markets/[id]/
// price-history`) 307-redirected to /auth/login. The client order-book fetch
// then parsed the login HTML as JSON, failed, and NO market ever showed its
// order book for logged-out visitors. Reads on those prefixes are public; the
// write handlers still enforce auth/RBAC themselves.

/** Routes that require an authenticated user for EVERY method (reads too).
 *  `/api/orders` GET returns the caller's own orders, so it stays here. */
export const FULLY_PROTECTED_ROUTES = [
  '/portfolio',
  '/settings',
  '/api/orders',
  '/api/payments',
] as const

/** Prefixes whose READS are public but whose WRITES require auth. */
export const WRITE_PROTECTED_PREFIXES = ['/api/markets'] as const

/** Admin console + admin APIs (also role-checked deeper in).
 *  H3: '/api/admin/*' MUST be listed here too. The admin APIs live under
 *  '/api/admin', which does NOT start with '/admin', so without this entry the
 *  edge gate skipped them entirely — the portal role check + 401/403 JSON path
 *  never ran and admin APIs were reachable by any authenticated (or, for the
 *  auth gate, unauthenticated) caller. Both prefixes are role-checked here and
 *  again per-capability inside each handler (defence in depth). */
export const ADMIN_ROUTES = ['/admin', '/api/admin'] as const

/** Safe/idempotent HTTP methods treated as public reads on the prefixes above. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** True when the HTTP method is a read (no write-gate on WRITE_PROTECTED prefixes). */
export function isReadMethod(method: string): boolean {
  return READ_METHODS.has((method || '').toUpperCase())
}

/** Does `pathname` fall under the admin console/APIs? */
export function isAdminRoute(pathname: string): boolean {
  return ADMIN_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/') || pathname.startsWith(r))
}

/**
 * Does a request to (pathname, method) require an authenticated user at the
 * edge? Admin routes are covered by isAdminRoute (they also need a role check),
 * so this returns the *auth-required* decision for non-admin protection.
 */
export function requiresAuth(pathname: string, method: string): boolean {
  if (FULLY_PROTECTED_ROUTES.some((r) => pathname.startsWith(r))) return true
  if (!isReadMethod(method) && WRITE_PROTECTED_PREFIXES.some((r) => pathname.startsWith(r))) return true
  return false
}
