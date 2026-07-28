import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// --- Mocks -----------------------------------------------------------------
// F5: the first deposit in a brand-new currency creates the wallet on-demand.
// The persisted deposits.wallet_id MUST be the id of the wallet actually in use
// (existing OR just-created) — never an empty string. If no wallet id can be
// resolved, the route must HARD-FAIL rather than insert a deposit row with an
// empty wallet_id.
//
// We mock the Supabase clients (auth + admin data access), keep the REAL pure
// getUsdRate currency helper, and stub the provider initiation.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }))
vi.mock('@/lib/payments', () => ({ initiateDeposit: vi.fn() }))

import { POST as depositPOST } from '@/app/api/payments/deposit/route'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { initiateDeposit } from '@/lib/payments'

const client = createClient as unknown as Mock
const admin = createAdminClient as unknown as Mock
const initiate = initiateDeposit as unknown as Mock

const USER = { id: 'user-1' }

// Authenticated supabase client stub.
function stubAuth(user: unknown = USER) {
  client.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user }, error: null }) },
  })
}

interface AdminConfig {
  // Existing wallet lookup result (null → triggers on-demand creation).
  wallet?: { id: string } | null
  // On-demand wallet insert result.
  walletInsert?: { id: string } | null
  walletInsertError?: unknown
  // exchange_rates lookup.
  rate?: { rate: number } | null
  // deposits insert result.
  depositInsert?: { data: { id: string } | null; error: unknown }
}

// Records the payload the route inserts into `deposits` so we can assert on the
// persisted wallet_id.
function stubAdmin(cfg: AdminConfig) {
  const captured: { depositInsert: Record<string, unknown> | null } = { depositInsert: null }
  admin.mockResolvedValue({
    from(table: string) {
      let inserted: Record<string, unknown> | null = null
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.eq = () => b
      b.update = () => b
      b.insert = (payload: Record<string, unknown>) => {
        inserted = payload
        if (table === 'deposits') captured.depositInsert = payload
        return b
      }
      b.single = async () => {
        if (table === 'wallets') {
          if (inserted) return { data: cfg.walletInsert ?? null, error: cfg.walletInsertError ?? null }
          return { data: cfg.wallet ?? null, error: null }
        }
        if (table === 'exchange_rates') return { data: cfg.rate ?? null, error: null }
        if (table === 'deposits') return cfg.depositInsert ?? { data: { id: 'dep-1' }, error: null }
        return { data: null, error: null }
      }
      b.maybeSingle = b.single
      return b
    },
  })
  return captured
}

function post(body: unknown) {
  return new Request('https://x/api/payments/deposit', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }) as unknown as NextRequest
}

const VALID_BODY = { amount: 100, currency: 'KES', phone: '254700000000', provider: 'mpesa', country: 'KE' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  initiate.mockResolvedValue({ success: true, providerReference: 'PR1', requiresPolling: true, message: 'ok' })
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/payments/deposit — F5 new-currency wallet_id', () => {
  it('persists the EXISTING wallet id when the user already has a wallet', async () => {
    stubAuth()
    const captured = stubAdmin({ wallet: { id: 'wallet-existing' }, rate: { rate: 0.0077 } })

    const res = await depositPOST(post(VALID_BODY))
    expect(res.status).toBe(200)
    expect(captured.depositInsert).not.toBeNull()
    expect(captured.depositInsert!.wallet_id).toBe('wallet-existing')
  })

  it('F5: first deposit in a NEW currency persists the just-created wallet id (never an empty string)', async () => {
    stubAuth()
    // No existing wallet → created on-demand with a real id.
    const captured = stubAdmin({
      wallet: null,
      walletInsert: { id: 'wallet-created' },
      rate: { rate: 0.0077 },
    })

    const res = await depositPOST(post(VALID_BODY))
    expect(res.status).toBe(200)
    expect(captured.depositInsert).not.toBeNull()
    expect(captured.depositInsert!.wallet_id).toBe('wallet-created')
    expect(captured.depositInsert!.wallet_id).not.toBe('')
  })

  it('F5: HARD-FAILS (no deposit inserted) when no wallet id can be resolved', async () => {
    stubAuth()
    // Wallet lookup empty AND the on-demand insert returns no row (no error,
    // but null data) → walletId stays undefined; must not insert a deposit.
    const captured = stubAdmin({ wallet: null, walletInsert: null, rate: { rate: 0.0077 } })

    const res = await depositPOST(post(VALID_BODY))
    expect(res.status).toBe(500)
    expect(captured.depositInsert).toBeNull()
    expect(initiate).not.toHaveBeenCalled()
  })
})
