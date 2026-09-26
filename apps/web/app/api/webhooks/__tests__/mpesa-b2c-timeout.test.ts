import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import type { NextRequest } from 'next/server'

// Audit 6.37: a B2C queue timeout is not a failure (the payout may still go
// through), so its endpoint never completes or refunds; before, it shared the
// result endpoint, where a non-zero code refunded the reserve.
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/payments/withdraw', () => ({ completeWithdrawal: vi.fn(), failWithdrawal: vi.fn() }))

import { POST } from '@/app/api/webhooks/mpesa-b2c/timeout/route'
import { createAdminClient } from '@/lib/supabase/server'
import { completeWithdrawal, failWithdrawal } from '@/lib/payments/withdraw'
import { processWithdrawal } from '@/lib/payments'

const rpc = vi.fn(async () => ({ data: null, error: null }))
beforeEach(() => {
  vi.clearAllMocks()
  process.env.MPESA_WEBHOOK_SECRET = 'real-secret'
  ;(createAdminClient as unknown as Mock).mockResolvedValue({
    from() {
      const b: Record<string, unknown> = {}
      b.select = () => b; b.eq = () => b
      b.maybeSingle = async () => ({ data: { id: 'wd-1' }, error: null })
      return b
    },
    rpc,
  })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { delete process.env.MPESA_WEBHOOK_SECRET; vi.restoreAllMocks(); vi.unstubAllGlobals() })

const timeoutBody = { Result: { ResultType: 1, ResultCode: 1, ResultDesc: 'The request timed out in the queue', ConversationID: 'AG_1' } }
const post = (url: string) => POST(new Request(url, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(timeoutBody),
}) as unknown as NextRequest)

describe('POST /api/webhooks/mpesa-b2c/timeout', () => {
  it('never completes or refunds; records the timeout on the withdrawal', async () => {
    const res = await post('https://x/api/webhooks/mpesa-b2c/timeout?token=real-secret')
    expect(res.status).toBe(200)
    expect(completeWithdrawal).not.toHaveBeenCalled()
    expect(failWithdrawal).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('note_withdrawal_status_check', expect.objectContaining({
      p_withdrawal_id: 'wd-1', p_result: expect.objectContaining({ verdict: 'mpesa_queue_timeout' }) }))
  })
  it('rejects an unverified caller', async () => {
    const res = await post('https://x/api/webhooks/mpesa-b2c/timeout?token=wrong')
    expect(res.status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('the payout registers the timeout endpoint, not the result endpoint, as QueueTimeOutURL', async () => {
    Object.assign(process.env, { MPESA_CONSUMER_KEY: 'k', MPESA_CONSUMER_SECRET: 's', NEXT_PUBLIC_APP_URL: 'https://app.test' })
    const bodies: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (String(url).includes('oauth')) return new Response(JSON.stringify({ access_token: 't' }), { status: 200 })
      bodies.push(init.body as string)
      return new Response(JSON.stringify({ ResponseCode: '0', ConversationID: 'AG_1' }), { status: 200 })
    }))
    await processWithdrawal('mpesa', { amount: 100, currency: 'KES', phone: '+254712345678', reference: 'wd-1' })
    const sent = JSON.parse(bodies[0])
    expect(new URL(sent.QueueTimeOutURL).pathname).toBe('/api/webhooks/mpesa-b2c/timeout')
    expect(new URL(sent.ResultURL).pathname).toBe('/api/webhooks/mpesa-b2c')
  })
})
