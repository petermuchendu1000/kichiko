// lib/supabase/client-lazy.ts
// ---------------------------------------------------------------------------
// The browser Supabase client, fetched when it is first needed instead of in
// the page's first load.
//
// WHY
// `@supabase/ssr` + `@supabase/supabase-js` is ~87 kB gzipped. Measured on
// 2026-10-16 it was the whole of ruling A11's failure: **13 of the 14
// over-budget routes carried that one chunk**, and the fourteenth (`/`) is
// over by 2 kB for unrelated reasons. A client component writing
//
//     const supabase = createClient()          // during render
//     ...
//     await supabase.auth.signInWithPassword() // only on submit
//
// puts the whole library in the bundle a visitor downloads before they can
// read the page, to serve a call that only happens if they press a button.
//
// WHEN TO USE WHICH
//   • `createClient()` from ./client — the client is needed DURING RENDER, or
//     synchronously in a layout effect that cannot await.
//   • `getBrowserClient()` from here — everywhere else: submit handlers,
//     effects that can await, realtime subscriptions, uploads. Which is most
//     places.
//
// The module is cached by the browser after the first call, and the promise is
// memoised here, so a second caller pays nothing. A failed chunk fetch (an
// offline tab, a deploy mid-session) clears the memo so the next attempt can
// retry rather than resolving a rejected promise forever.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database'

export type BrowserClient = SupabaseClient<Database>

let cached: Promise<BrowserClient> | null = null

/** The browser client, loading `@supabase/ssr` on first use. */
export function getBrowserClient(): Promise<BrowserClient> {
  if (!cached) {
    cached = import('./client')
      .then((m) => m.createClient() as BrowserClient)
      .catch((err) => {
        cached = null
        throw err
      })
  }
  return cached
}

/**
 * The client if it has already loaded, otherwise null — for the rare caller
 * that must stay synchronous (an unmount cleanup, say) and can correctly do
 * nothing when the library was never needed.
 */
export function peekBrowserClient(): Promise<BrowserClient> | null {
  return cached
}
