// middleware.ts - Auth + security middleware (rate limiting, security headers)
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { ADMIN_PORTAL_ROLES } from '@/lib/admin/rbac'
import {
  RATE_RULES,
  bucketForPath,
  clientKey,
  enforce,
  rateLimitHeaders,
} from '@/lib/security/rate-limit'
import { securityHeaders } from '@/lib/security/headers'
import { safeRedirectPath } from '@/lib/security/sanitize'
import { REQUEST_ID_HEADER, resolveRequestId } from '@/lib/observability/request-id'
import { requiresAuth, isAdminRoute } from '@/lib/security/route-protection'

const ADMIN_PORTAL_ROLE_SET = new Set<string>(ADMIN_PORTAL_ROLES)

// Security headers (incl. CSP/HSTS) built once per isolate for the current env.
const SECURITY_HEADERS = securityHeaders({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  allowUnsafeEval: process.env.NODE_ENV !== 'production',
})

function applySecurityHeaders(res: NextResponse, requestId?: string): NextResponse {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v)
  if (requestId) res.headers.set(REQUEST_ID_HEADER, requestId)
  return res
}

// Route-protection rules live in lib/security/route-protection.ts (pure +
// unit-tested). See that file for the order-book regression history.

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // ---- Correlation id -------------------------------------------------------
  // Resolve (or mint) a request id and propagate it to handlers via request
  // headers; it's echoed on every response by applySecurityHeaders.
  const requestId = resolveRequestId(request.headers)
  request.headers.set(REQUEST_ID_HEADER, requestId)

  // ---- Rate limiting (fail-open) --------------------------------------------
  // Applied early so abusive traffic is shed before doing session work. The
  // default store is per-isolate in-memory; back it with Upstash in production.
  const bucket = bucketForPath(pathname)
  if (bucket) {
    const rule = RATE_RULES[bucket]
    const key = `${bucket}:${clientKey(request.headers)}`
    const decision = enforce(key, rule)
    if (!decision.allowed) {
      return applySecurityHeaders(
        NextResponse.json(
          { error: 'Too many requests. Please slow down.', code: 'rate_limited', request_id: requestId },
          { status: 429, headers: rateLimitHeaders(decision) }
        ),
        requestId
      )
    }
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // Refresh session
  const { data: { user } } = await supabase.auth.getUser()

  // Protect routes. Reads on public prefixes (e.g. GET /api/markets/[id]/book)
  // pass through; writes and fully-gated routes require a user. See
  // lib/security/route-protection.ts.
  const isAdmin = isAdminRoute(pathname)
  const needsAuth = requiresAuth(pathname, request.method)

  if ((needsAuth || isAdmin) && !user) {
    // API routes must NEVER be answered with an HTML redirect. A fetch() caller
    // follows the 3xx to the login page and then chokes parsing that HTML (or an
    // empty body) as JSON — the "Unexpected end of JSON input" that broke the
    // withdraw modal. Same regression the order-book reads hit (see
    // lib/security/route-protection.ts history). Return a machine-readable 401
    // so the client can surface a real message / re-auth instead of crashing.
    if (pathname.startsWith('/api/')) {
      return applySecurityHeaders(
        NextResponse.json(
          { error: 'Authentication required', code: 'unauthenticated', request_id: requestId },
          { status: 401 },
        ),
        requestId,
      )
    }
    const loginUrl = new URL('/auth/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Defense-in-depth: enforce the staff/portal role set at the edge for /admin.
  // Individual pages & admin APIs additionally check per-capability; this blocks
  // non-portal users earlier. superadmin is included via ADMIN_PORTAL_ROLES.
  if (isAdmin && user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    if (!profile || !ADMIN_PORTAL_ROLE_SET.has(profile.role)) {
      // As above: never hand an HTML redirect to an /api caller — return a
      // parseable 403 so admin fetch() calls fail cleanly instead of crashing
      // on the redirected home-page body.
      if (pathname.startsWith('/api/')) {
        return applySecurityHeaders(
          NextResponse.json(
            { error: 'Forbidden', code: 'forbidden', request_id: requestId },
            { status: 403 },
          ),
          requestId,
        )
      }
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  // Redirect authenticated users away from auth pages. Honor ?next (sanitized)
  // instead of always going home, so a mid-bet sign-in / sign-up returns the
  // user to the market they were on. This is the authoritative server-side
  // redirect — it also covers the returning-already-authenticated and OAuth
  // cases and the router.refresh() re-request race after a client sign-in.
  if (user && (pathname.startsWith('/auth/login') || pathname.startsWith('/auth/register'))) {
    const dest = safeRedirectPath(request.nextUrl.searchParams.get('next'))
    return NextResponse.redirect(new URL(dest, request.url))
  }

  // Security headers (CSP, HSTS, X-Frame-Options, etc.) — centralised set.
  return applySecurityHeaders(response, requestId)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
