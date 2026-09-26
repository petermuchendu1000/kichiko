import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// Audit 6.7: `flags.withdraw_kyc_gate` is a non-public setting, invisible to
// the user's client under RLS; the withdraw route read it with that client,
// so the gate could never turn on. Settings a route enforces are now read with
// the service role (lib/platform-gate.ts). Kill switches (deposits,
// withdrawals, market creation) and maintenance mode were not enforced at all.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createAdminClient: vi.fn() }))
vi.mock('@/lib/payments', () => ({ initiateDeposit: vi.fn(), processWithdrawal: vi.fn() }))
vi.mock('@/lib/payments/withdraw', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/payments/withdraw')>()),
  withdrawalAmountUsd: vi.fn(async () => 300),     // above the KYC threshold, below review
  requestWithdrawal: vi.fn(async () => ({ withdrawal_id: 'wd-1', status: 'processing' })),
}))

import { POST as withdrawPOST } from '@/app/api/payments/withdraw/route'
import { POST as depositPOST } from '@/app/api/payments/deposit/route'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requestWithdrawal } from '@/lib/payments/withdraw'
import { initiateDeposit } from '@/lib/payments'
import { platformGate } from '@/lib/platform-gate'

let serviceSettings: Array<{ key: string; value: unknown }> = []
let settingsReadFails = false

function builder(table: string, asService: boolean) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'insert', 'update', 'order', 'limit']) b[m] = () => b
  // RLS: the user's client never sees non-public settings; here it sees none
  b.in = async () => (table === 'platform_settings'
    ? (settingsReadFails ? { data: null, error: { message: 'down' } } : { data: asService ? serviceSettings : [], error: null })
    : { data: [], error: null })
  b.single = async () => ({ data: { id: `${table}-1`, rate: 0.00775 }, error: null })
  b.maybeSingle = async () => (table === 'platform_settings'
    ? { data: asService ? serviceSettings[0] ?? null : null, error: null }
    : { data: { id: `${table}-1` }, error: null })
  return b
}

beforeEach(() => {
  vi.clearAllMocks()
  serviceSettings = []
  settingsReadFails = false
  ;(createClient as unknown as Mock).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (t: string) => builder(t, false),
    rpc: (name: string) => name === 'user_settlement'
      ? Promise.resolve({ data: [{ country: 'KE', currency: 'KES', wallet_id: 'w1', locked: true }], error: null })
      : { maybeSingle: async () => ({ data: { account_status: 'active', kyc_status: 'pending' } }) },
  })
  ;(createAdminClient as unknown as Mock).mockResolvedValue({
    from: (t: string) => builder(t, true),
    rpc: async () => ({ data: null, error: null }),
  })
})
afterEach(() => { delete process.env.FLAG_WITHDRAWALS_ENABLED })

const withdraw = () => withdrawPOST(new Request('https://x/api/payments/withdraw', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ amount: 40000, phone_number: '+254712345678', provider: 'mpesa' }),
}) as unknown as NextRequest)
const deposit = () => depositPOST(new Request('https://x/api/payments/deposit', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ amount: 500, phone: '+254712345678', provider: 'mpesa' }),
}) as unknown as NextRequest)

describe('audit 6.7: the withdrawal KYC gate', () => {
  it('turned on by compliance, it gates an unverified user (read with the service role)', async () => {
    serviceSettings = [{ key: 'flags.withdraw_kyc_gate', value: true }, { key: 'limits.kyc_required_usd', value: 100 }]
    const res = await withdraw()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ kyc_required: true })
    expect(requestWithdrawal).not.toHaveBeenCalled()
  })
  it('off (the default), it does not gate', async () => {
    const res = await withdraw()
    expect(res.status).not.toBe(403)
  })
})

describe('kill switches and maintenance', () => {
  it('withdrawals paused -> 503, nothing reserved', async () => {
    serviceSettings = [{ key: 'flags.withdrawals_enabled', value: false }]
    const res = await withdraw()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: 'withdrawals_paused' })
    expect(requestWithdrawal).not.toHaveBeenCalled()
  })
  it('the env override pauses withdrawals without a DB change', async () => {
    process.env.FLAG_WITHDRAWALS_ENABLED = 'false'
    expect((await withdraw()).status).toBe(503)
  })
  it('deposits paused -> 503, provider never called', async () => {
    serviceSettings = [{ key: 'flags.deposits_enabled', value: false }]
    const res = await deposit()
    expect(res.status).toBe(503)
    expect(initiateDeposit).not.toHaveBeenCalled()
  })
  it('maintenance freezes deposits and withdrawals', async () => {
    serviceSettings = [{ key: 'maintenance.enabled', value: true }]
    expect((await deposit()).status).toBe(503)
    expect((await withdraw()).status).toBe(503)
  })
  it('settings unreadable -> fails closed', async () => {
    settingsReadFails = true
    const res = await withdraw()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: 'settings_unavailable' })
  })
  it('platformGate: defaults are open; trading has no own switch but maintenance stops it', async () => {
    const admin = { from: () => builder('platform_settings', true) }
    expect((await platformGate('trading', [], admin as never)).ok).toBe(true)
    serviceSettings = [{ key: 'maintenance.enabled', value: 'true' }]
    expect(await platformGate('trading', [], admin as never)).toMatchObject({ ok: false, code: 'maintenance' })
    serviceSettings = [{ key: 'flags.market_creation_enabled', value: false }]
    expect(await platformGate('market_creation', [], admin as never)).toMatchObject({ ok: false, code: 'market_creation_paused' })
  })
})
