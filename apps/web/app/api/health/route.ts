// app/api/health/route.ts — liveness/readiness probe with structured checks.
//
// Returns overall status plus per-dependency checks and latency. Never leaks
// secrets. Correlates via the X-Request-Id set in middleware and logs the
// outcome through the structured logger. Used by uptime monitors and the CI
// smoke step; also exposed at /health via a rewrite.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/observability/logger'
import { REQUEST_ID_HEADER, resolveRequestId } from '@/lib/observability/request-id'

export const dynamic = 'force-dynamic'

interface Check {
  name: string
  status: 'ok' | 'error'
  latency_ms: number
  error?: string
}

const BOOT_TIME = Date.now()

export async function GET(req: NextRequest) {
  const requestId = resolveRequestId(req.headers)
  const log = logger.child({ request_id: requestId, route: '/api/health' })
  const started = Date.now()
  const checks: Check[] = []

  // Dependency: database reachability (cheap indexed read).
  const dbStart = Date.now()
  try {
    const supabase = await createClient()
    const { error } = await supabase.from('exchange_rates').select('id').limit(1)
    if (error) log.error('health: database check failed', { error: error.message })
    checks.push({
      name: 'database',
      status: error ? 'error' : 'ok',
      latency_ms: Date.now() - dbStart,
      // public endpoint: the reason is logged, not returned (audit 6.25)
      ...(error ? { error: 'unreachable' } : {}),
    })
  } catch (e) {
    checks.push({
      name: 'database',
      status: 'error',
      latency_ms: Date.now() - dbStart,
      error: 'connection failed',
    })
  }

  const healthy = checks.every((c) => c.status === 'ok')
  const body = {
    status: healthy ? 'ok' : 'degraded',
    checks,
    latency_ms: Date.now() - started,
    uptime_s: Math.round((Date.now() - BOOT_TIME) / 1000),
    version: process.env.NEXT_PUBLIC_APP_VERSION || process.env.npm_package_version || '1.0.0',
    commit: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || null,
    timestamp: new Date().toISOString(),
    request_id: requestId,
  }

  if (!healthy) log.error('health check degraded', { checks })
  else log.debug('health check ok', { latency_ms: body.latency_ms })

  return NextResponse.json(body, {
    status: healthy ? 200 : 503,
    headers: { [REQUEST_ID_HEADER]: requestId, 'Cache-Control': 'no-store' },
  })
}
