/**
 * Resolves the Supabase service-role key and FAILS LOUDLY if it is missing or
 * is actually an anon/publishable key.
 *
 * Why this exists: `createServerClient(url, key)` never errors on a bad key --
 * it just authenticates as whatever role the key maps to. If the service slot
 * is empty or holds the anon/publishable key, the "admin" client silently runs
 * as `anon`, and every privileged RPC (clob_place_order, clob_cancel_order,
 * resolve_market, credit_deposit, ...) fails deep in the stack with an opaque
 *   42501 "permission denied for function <fn>"
 * that looks like a database-grant bug but is really a misconfigured env var.
 * We surface the real cause here instead.
 *
 * Accepts either key format:
 *   - new secret key:  sb_secret_...            (rejects sb_publishable_...)
 *   - legacy JWT:      role claim === service_role (rejects role === anon)
 */
export function resolveServiceRoleKey(
  env: Record<string, string | undefined> = process.env,
): string {
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. The admin Supabase client needs the ' +
        'service-role secret (sb_secret_... or the legacy service_role JWT). Without ' +
        'it, privileged RPCs fail with "permission denied for function ..." (42501). ' +
        'Set it in your environment (.env.local / hosting secrets) -- never expose it ' +
        'to the browser (do NOT prefix with NEXT_PUBLIC_).',
    )
  }

  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const looksPublishable =
    key.startsWith('sb_publishable_') || (anonKey != null && key === anonKey)

  let looksAnonJwt = false
  if (key.split('.').length === 3) {
    try {
      const payload = JSON.parse(
        Buffer.from(key.split('.')[1], 'base64').toString('utf8'),
      ) as { role?: string }
      if (payload.role && payload.role !== 'service_role') looksAnonJwt = true
    } catch {
      // Unparseable JWT payload -- fall through; createServerClient will reject it.
    }
  }

  if (looksPublishable || looksAnonJwt) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY appears to hold an anon/publishable key, not the ' +
        'service-role secret. The admin client would run as `anon` and every ' +
        'privileged RPC would fail with 42501 (permission denied). Set ' +
        'SUPABASE_SERVICE_ROLE_KEY to your sb_secret_... key (or the legacy ' +
        'service_role JWT).',
    )
  }

  return key
}
