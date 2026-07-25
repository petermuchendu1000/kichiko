import { describe, it, expect } from 'vitest'
import { readJson } from '@/lib/http/client'

// Regression guard for the withdraw-modal crash: a fetch() response with an
// empty or non-JSON body must never throw "Unexpected end of JSON input".
// readJson() should degrade to {} so callers can safely branch on res.ok.

function res(body: string, init?: ResponseInit): Response {
  // Response is available in the vitest (jsdom/undici) environment.
  return new Response(body, init)
}

describe('readJson', () => {
  it('parses a normal JSON body', async () => {
    const r = res(JSON.stringify({ success: true, withdrawal_id: 'w_1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    await expect(readJson<{ success: boolean; withdrawal_id: string }>(r)).resolves.toEqual({
      success: true,
      withdrawal_id: 'w_1',
    })
  })

  it('returns {} for an empty body instead of throwing', async () => {
    // This is the exact shape that produced "Unexpected end of JSON input":
    // an empty body (e.g. a followed auth redirect / crashed handler).
    const r = res('', { status: 401 })
    await expect(readJson(r)).resolves.toEqual({})
  })

  it('returns {} for a 204 No Content response', async () => {
    const r = new Response(null, { status: 204 })
    await expect(readJson(r)).resolves.toEqual({})
  })

  it('returns {} for a non-JSON (HTML) body instead of throwing', async () => {
    const r = res('<!DOCTYPE html><html><body>Login</body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })
    await expect(readJson(r)).resolves.toEqual({})
  })

  it('parses an error envelope so callers can surface the reason', async () => {
    const r = res(JSON.stringify({ error: 'Insufficient balance' }), { status: 400 })
    await expect(readJson<{ error: string }>(r)).resolves.toEqual({ error: 'Insufficient balance' })
  })
})
