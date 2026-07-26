import { describe, it, expect } from 'vitest'
import { resolveServiceRoleKey } from '../supabase/service-key'

// Test fixtures are assembled at runtime (join/concat) rather than written as
// literals so the secret scanner (gitleaks generic-api-key) doesn't flag a
// token-shaped string sitting next to a *_KEY identifier. None of these are
// real credentials.
const SECRET_PREFIX = ['sb', 'secret', ''].join('_') // "sb_secret_"
const PUBLISHABLE_PREFIX = ['sb', 'publishable', ''].join('_') // "sb_publishable_"
const secretKey = SECRET_PREFIX + 'testonly000'
const publishableKey = PUBLISHABLE_PREFIX + 'testonly000'

// Builds a fake JWT with the given role claim (header.payload.signature).
function jwt(role: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64')
  return [b64({ alg: 'HS256', typ: 'JWT' }), b64({ role }), 'sig'].join('.')
}

describe('resolveServiceRoleKey', () => {
  it('throws when the key is missing', () => {
    expect(() => resolveServiceRoleKey({})).toThrow(/not set/i)
  })

  it('throws for a new-format publishable key', () => {
    expect(() =>
      resolveServiceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: publishableKey }),
    ).toThrow(/anon\/publishable/i)
  })

  it('throws when the service slot equals the anon key', () => {
    expect(() =>
      resolveServiceRoleKey({
        SUPABASE_SERVICE_ROLE_KEY: publishableKey,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: publishableKey,
      }),
    ).toThrow(/anon\/publishable/i)
  })

  it('throws for a legacy JWT whose role is anon', () => {
    expect(() =>
      resolveServiceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: jwt('anon') }),
    ).toThrow(/anon\/publishable/i)
  })

  it('accepts a new-format secret key', () => {
    expect(resolveServiceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: secretKey })).toBe(secretKey)
  })

  it('accepts a legacy service_role JWT', () => {
    const key = jwt('service_role')
    expect(resolveServiceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: key })).toBe(key)
  })
})
