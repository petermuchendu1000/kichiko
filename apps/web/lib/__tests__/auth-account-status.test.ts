import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// Audit 6.31: a missing or failed profile read used to default to an ACTIVE
// account, so a suspended user passed requireUser whenever get_my_profile
// errored or returned nothing.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { requireUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

const client = createClient as unknown as Mock
const stub = (profile: unknown, error: unknown = null) => client.mockResolvedValue({
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
  rpc: () => ({ maybeSingle: async () => ({ data: profile, error }) }),
})
beforeEach(() => vi.clearAllMocks())

describe('requireUser and the account status', () => {
  it('an active profile passes', async () => {
    stub({ role: 'user', account_status: 'active', kyc_status: 'unverified' })
    expect((await requireUser()).ok).toBe(true)
  })
  it('a suspended profile is refused', async () => {
    stub({ role: 'user', account_status: 'suspended' })
    expect((await requireUser()).ok).toBe(false)
  })
  it('a profile read that failed or returned nothing is refused (not treated as active)', async () => {
    stub(null, { message: 'boom' })
    const r = await requireUser()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(403)
    stub(null)
    expect((await requireUser()).ok).toBe(false)
  })
})
