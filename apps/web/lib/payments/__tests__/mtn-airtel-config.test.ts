import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Audit 6.12: MTN payout initiation and re-query disagreed on configuration
// (target environment 'mtnuganda' vs raw MTN_MOMO_ENV 'production'; key
// MTN_MOMO_DISBURSEMENT_KEY vs MTN_MOMO_DISBURSE_KEY), so every production
// payout stayed 'processing'. Audit 6.11: Airtel payouts were re-queried on the
// COLLECTION endpoint with X-Country KE. One resolver per provider now feeds
// initiation and re-query alike.
vi.mock('axios', () => {
  const get = vi.fn()
  const post = vi.fn()
  return { default: { get, post }, get, post }
})
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn(async () => { throw new Error('no db in tests') }) }))

import axios from 'axios'
import { processWithdrawal } from '@/lib/payments'
import { buildMtnConfig, MtnConfigError } from '@/lib/payments/mtn-config'
import { getMoMoTransferStatus } from '@/lib/payments/mtn-momo'
import { airtelDisbursementStatus, buildAirtelConfig } from '@/lib/payments/airtel-money'

const ax = axios as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> }
const NONE = { config: {}, secrets: {} }
const saved = { ...process.env }

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(process.env)) if (/^(MTN_MOMO_|AIRTEL_|PAYMENTS_ENV)/.test(k)) delete process.env[k]
})
afterEach(() => { vi.unstubAllGlobals(); process.env = { ...saved } })

describe('buildMtnConfig', () => {
  it('sandbox by default', () => {
    expect(buildMtnConfig(NONE, 'UG', {}).targetEnvironment).toBe('sandbox')
  })
  it("MTN_MOMO_ENV=production means the country's target, never the literal 'production'", () => {
    expect(buildMtnConfig(NONE, 'UG', { MTN_MOMO_ENV: 'production' }).targetEnvironment).toBe('mtnuganda')
    expect(buildMtnConfig(NONE, 'UG', { PAYMENTS_ENV: 'production' }).targetEnvironment).toBe('mtnuganda')
  })
  it('an explicit target wins (DB field, MTN_MOMO_TARGET_ENV, or a real target in MTN_MOMO_ENV)', () => {
    expect(buildMtnConfig({ config: { target_environment: 'mtnghana' }, secrets: {} }, 'UG', { PAYMENTS_ENV: 'production' }).targetEnvironment).toBe('mtnghana')
    expect(buildMtnConfig(NONE, 'UG', { MTN_MOMO_TARGET_ENV: 'mtnzambia' }).targetEnvironment).toBe('mtnzambia')
    expect(buildMtnConfig(NONE, 'UG', { MTN_MOMO_ENV: 'mtnuganda' }).targetEnvironment).toBe('mtnuganda')
  })
  it('production refuses to guess a target for an unmapped country, and refuses sandbox', () => {
    expect(() => buildMtnConfig(NONE, 'RW', { PAYMENTS_ENV: 'production' })).toThrow(MtnConfigError)
    expect(() => buildMtnConfig(NONE, 'UG', { PAYMENTS_ENV: 'production', MTN_MOMO_TARGET_ENV: 'sandbox' })).toThrow(MtnConfigError)
  })
  it('one disbursement key: the new name, else the legacy name, else the collection key', () => {
    expect(buildMtnConfig(NONE, 'UG', { MTN_MOMO_DISBURSEMENT_KEY: 'new', MTN_MOMO_DISBURSE_KEY: 'old' }).disbursement.subscriptionKey).toBe('new')
    expect(buildMtnConfig(NONE, 'UG', { MTN_MOMO_DISBURSE_KEY: 'old' }).disbursement.subscriptionKey).toBe('old')
    expect(buildMtnConfig(NONE, 'UG', { MTN_MOMO_SUBSCRIPTION_KEY: 'col' }).disbursement.subscriptionKey).toBe('col')
    expect(buildMtnConfig({ config: {}, secrets: { disbursement_key: 'db' } }, 'UG', { MTN_MOMO_DISBURSEMENT_KEY: 'new' }).disbursement.subscriptionKey).toBe('db')
  })
})

describe('MTN payout and re-query agree (production)', () => {
  it('same X-Target-Environment and subscription key on initiation and GET /transfer', async () => {
    Object.assign(process.env, {
      MTN_MOMO_ENV: 'production', MTN_MOMO_DISBURSE_KEY: 'disb-key', MTN_MOMO_API_USER: 'u', MTN_MOMO_API_KEY: 'k',
      MTN_MOMO_BASE_URL: 'https://mtn.test',
    })
    const seen: Array<{ url: string; headers: Record<string, string> }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), headers: init.headers as Record<string, string> })
      return String(url).endsWith('/token/')
        ? new Response(JSON.stringify({ access_token: 't' }), { status: 200 })
        : new Response('', { status: 202 })
    }))
    const r = await processWithdrawal('mtn_momo', { amount: 5000, currency: 'UGX', phone: '+256772000000', reference: 'wd-1' })
    expect(r.outcome).toBe('accepted')
    const init = seen.find((x) => x.url.endsWith('/disbursement/v1_0/transfer'))!

    ax.post.mockResolvedValue({ data: { access_token: 't' } })
    ax.get.mockResolvedValue({ data: { status: 'SUCCESSFUL' } })
    await getMoMoTransferStatus(r.reference!, 'UGX')
    const q = ax.get.mock.calls[0]
    expect(q[0]).toBe(`https://mtn.test/disbursement/v1_0/transfer/${r.reference}`)
    expect(init.headers['X-Target-Environment']).toBe('mtnuganda')
    expect(q[1].headers['X-Target-Environment']).toBe(init.headers['X-Target-Environment'])
    expect(q[1].headers['Ocp-Apim-Subscription-Key']).toBe(init.headers['Ocp-Apim-Subscription-Key'])
    expect(init.headers['Ocp-Apim-Subscription-Key']).toBe('disb-key')
  })
})

describe('Airtel', () => {
  it('payout re-query uses the DISBURSEMENT enquiry endpoint in the payout currency', async () => {
    process.env.AIRTEL_MONEY_BASE_URL = 'https://airtel.test'
    ax.post.mockResolvedValue({ data: { access_token: 't' } })
    ax.get.mockResolvedValue({ data: { data: { transaction: { id: 'wd-1', status: 'ts', airtel_money_id: 'AM9' } } } })
    const r = await airtelDisbursementStatus('wd-1', 'UGX')
    expect(r).toMatchObject({ status: 'TS', airtelMoneyId: 'AM9' })
    const [url, opts] = ax.get.mock.calls[0]
    expect(url).toBe('https://airtel.test/standard/v1/disbursements/wd-1')
    expect(opts.headers).toMatchObject({ 'X-Country': 'UG', 'X-Currency': 'UGX' })
  })
  it('an unsupported payout currency throws (the webhook then stays pending)', async () => {
    await expect(airtelDisbursementStatus('wd-1', 'ETB')).rejects.toThrow()
  })
  it('the disbursement PIN: DB secret, else AIRTEL_DISBURSEMENT_PIN, else AIRTEL_MONEY_PIN (the admin form name)', () => {
    expect(buildAirtelConfig(NONE, { AIRTEL_MONEY_PIN: 'form' }).pin).toBe('form')
    expect(buildAirtelConfig(NONE, { AIRTEL_MONEY_PIN: 'form', AIRTEL_DISBURSEMENT_PIN: 'pay' }).pin).toBe('pay')
    expect(buildAirtelConfig({ config: {}, secrets: { disbursement_pin: 'db' } }, { AIRTEL_DISBURSEMENT_PIN: 'pay' }).pin).toBe('db')
  })
  it('the payout is sent with X-Country/X-Currency of the payout and the resolved PIN', async () => {
    Object.assign(process.env, { AIRTEL_MONEY_CLIENT_ID: 'c', AIRTEL_MONEY_CLIENT_SECRET: 's', AIRTEL_MONEY_PIN: '1234' })
    const seen: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url: String(url), init })
      return String(url).includes('/oauth2/')
        ? new Response(JSON.stringify({ access_token: 't' }), { status: 200 })
        : new Response(JSON.stringify({ status: { success: true }, data: { transaction: { id: 'wd-1', status: 'TIP' } } }), { status: 200 })
    }))
    const r = await processWithdrawal('airtel_money', { amount: 900, currency: 'KES', phone: '+254733000000', reference: 'wd-1' })
    expect(r.outcome).toBe('accepted')
    const pay = seen.find((x) => x.url.includes('/disbursements/'))!
    expect(pay.init.headers).toMatchObject({ 'X-Country': 'KE', 'X-Currency': 'KES' })
    expect(JSON.parse(pay.init.body as string).pin).toBe('1234')
  })
})
