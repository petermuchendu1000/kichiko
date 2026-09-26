import { describe, it, expect, vi, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

// OPT-IN end-to-end check of the payout worker against a real PostgREST +
// Postgres with migration 083 (only the provider HTTP is stubbed): proves the
// RPC names, argument names and return shapes the TypeScript uses match the
// SQL. Skipped unless PAYOUTS_E2E_URL (PostgREST behind a /rest/v1 prefix),
// PAYOUTS_E2E_KEY (a service_role JWT) and PAYOUTS_E2E_DB (psql URL, for
// setup) are set. COMMITS rows to that database: throwaway databases only.
const URL = process.env.PAYOUTS_E2E_URL
const KEY = process.env.PAYOUTS_E2E_KEY
const DB = process.env.PAYOUTS_E2E_DB

vi.mock('axios', () => {
  const get = vi.fn(async () => ({ data: { status: 'SUCCESSFUL', financialTransactionId: 'FT-1' } }))
  const post = vi.fn(async () => ({ data: { access_token: 't' } }))
  return { default: { get, post }, get, post }
})
vi.mock('@/lib/supabase/server', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  const sb = () => createClient(process.env.PAYOUTS_E2E_URL!, process.env.PAYOUTS_E2E_KEY!, { auth: { persistSession: false } })
  return { createAdminClient: vi.fn(async () => sb()), createClient: vi.fn(async () => sb()) }
})

const psql = (sql: string) => execFileSync('psql', [DB!, '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim()

describe.skipIf(!URL || !KEY || !DB)('payout worker end to end (PostgREST + 083)', () => {
  let userId = ''
  let walletId = ''

  beforeAll(() => {
    userId = randomUUID()
    psql(`insert into auth.users(id,email,raw_user_meta_data) values ('${userId}','po-${userId.slice(0, 8)}@example.com','{"display_name":"po e2e","country_code":"UG"}')`)
    walletId = psql(`insert into wallets(user_id,currency,available_balance,is_active) values ('${userId}','UGX',1000000,true)
                     on conflict (user_id,currency) do update set available_balance=1000000, reserved_balance=0 returning id`).split('\n')[0]
    Object.assign(process.env, { MTN_MOMO_DISBURSEMENT_KEY: 'k', MTN_MOMO_API_USER: 'u', MTN_MOMO_API_KEY: 'a', MTN_MOMO_BASE_URL: 'https://mtn.test' })
    const realFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input instanceof Request ? input.url : input)
      if (u.startsWith('https://mtn.test/disbursement/token/')) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 })
      if (u.startsWith('https://mtn.test/disbursement/v1_0/transfer')) return new Response('', { status: 202 })
      return realFetch(input, init)
    })
  })

  it('an approved withdrawal is claimed, sent once, marked sent, then settled by the status sweep', async () => {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { runPayoutDispatch, runPayoutStatusSweep } = await import('@/lib/payments/payouts')
    const sb = await createAdminClient()

    const { data: req, error } = await sb.rpc('request_withdrawal' as never, {
      p_user_id: userId, p_wallet_id: walletId, p_amount: 50000, p_amount_usd: 13.5, p_exchange_rate: 0.00027,
      p_fee_amount: 0, p_provider: 'mtn_momo', p_phone: '+256772000000', p_requires_review: true,
    } as never)
    expect(error).toBeNull()
    const id = (req as unknown as { withdrawal_id: string }).withdrawal_id
    expect(psql(`select payout_state from withdrawals where id='${id}'`)).toBe('awaiting_review')

    // not sent while under review
    const before = await runPayoutDispatch(sb, 50)
    expect(before.find((r) => r.id === id)).toBeUndefined()

    psql(`update withdrawals set requires_review=false where id='${id}'`)   // what admin_approve_withdrawal does
    const sent = await runPayoutDispatch(sb, 50)
    const mine = sent.filter((r) => r.id === id)
    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ outcome: 'accepted', recorded: true })
    const [state, ref] = psql(`select payout_state||'|'||coalesce(provider_reference,'') from withdrawals where id='${id}'`).split('|')
    expect(state).toBe('sent')
    expect(ref).toMatch(/^[0-9a-f-]{36}$/)

    // a second worker run does not send it again
    const again = await runPayoutDispatch(sb, 50)
    expect(again.find((r) => r.id === id)).toBeUndefined()

    psql(`update withdrawals set next_check_at = now() - interval '1 second' where id='${id}'`)
    const counts = await runPayoutStatusSweep(sb, 50)
    expect(counts.completed).toBeGreaterThanOrEqual(1)
    expect(psql(`select status||'|'||payout_state from withdrawals where id='${id}'`)).toBe('completed|settled')
    expect(psql(`select reserved_balance::numeric from wallets where id='${walletId}'`)).toBe('0.000000')
    expect(psql(`select count(*) from wallet_reservation_drift() where wallet_id='${walletId}'`)).toBe('0')
  })
})
