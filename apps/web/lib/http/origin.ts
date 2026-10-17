// lib/http/origin.ts — which origin a server route should build URLs from.
//
// There are two answers, and using the wrong one is a vulnerability in one
// direction and an outage in the other. They are kept side by side so the
// choice has to be made deliberately.

import type { NextRequest } from 'next/server'

/**
 * The origin the USER reached us on, for redirecting them back to a path we
 * have already validated.
 *
 * NOT `new URL(request.url).origin`. Behind Fly's proxy that is the
 * container's own bind address, and because fly.toml binds `::` (6PN is
 * IPv6-only) it renders as the literal `https://[::]:3000`. That is exactly
 * what /auth/confirm emitted on its first production deploy, sending every
 * emailed link to an address no browser can reach.
 *
 * `x-forwarded-host` is attacker-controllable in principle. It is safe HERE
 * only because the result is used to redirect to an internal path that was
 * validated separately: the worst a forged header achieves is sending the
 * forger to their own host. Never use this for a URL that will be handed to a
 * third party or stored.
 */
export function forwardedOrigin(request: NextRequest, fallback: string): string {
  const host = request.headers.get('x-forwarded-host')
  if (host) {
    const proto = request.headers.get('x-forwarded-proto') || 'https'
    return `${proto}://${host}`
  }
  return process.env.NEXT_PUBLIC_APP_URL || fallback
}

/**
 * Our own canonical origin, from configuration alone.
 *
 * Use this for any URL that leaves the system: a callback given to a payment
 * or verification vendor, a link in an email, anything persisted. A vendor
 * callback built from `x-forwarded-host` is an open redirect with a third
 * party holding the trigger — send one request with a forged header and the
 * vendor will later walk a real user to the attacker's host carrying whatever
 * the vendor appends to it.
 *
 * Throws rather than guessing. A missing NEXT_PUBLIC_APP_URL is a deployment
 * fault, and the failure must land on the request that needed it rather than
 * on a user three steps later wondering why they were redirected nowhere.
 */
export function canonicalOrigin(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL
  if (!url) throw new Error('NEXT_PUBLIC_APP_URL is not set')
  return url.replace(/\/+$/, '')
}
