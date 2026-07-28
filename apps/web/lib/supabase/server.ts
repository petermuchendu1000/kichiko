import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceRoleClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { Database } from './database'
import { resolveServiceRoleKey } from './service-key'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method is called from a Server Component.
            // This can be ignored if you have middleware refreshing user sessions.
          }
        },
      },
    }
  )
}

export async function createAdminClient() {
  // A true service-role client must NOT carry the end-user session. The previous
  // implementation used the cookie-aware SSR client (createServerClient + cookies),
  // so inside an authenticated request the user's session JWT (read from cookies)
  // OVERRODE the service-role key on the Authorization header — PostgREST then ran
  // as `authenticated`, not `service_role`. That made service_role-only RPCs
  // (clob_place_order, clob_cancel_order, resolve_market, ...) fail with
  //   42501 "permission denied for function ..."
  // for logged-in users, while broadly-granted RPCs (e.g. clob_get_book) still
  // worked — exactly the observed order-placement failure.
  //
  // Use the plain supabase-js client bound to the service-role key with no session
  // persistence, so it always authenticates as service_role regardless of request
  // cookies. resolveServiceRoleKey() still fails loudly on a missing/anon key.
  return createServiceRoleClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    resolveServiceRoleKey(),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )
}
