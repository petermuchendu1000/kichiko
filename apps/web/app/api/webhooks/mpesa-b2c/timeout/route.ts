// app/api/webhooks/mpesa-b2c/timeout/route.ts — M-Pesa B2C queue timeout (audit 6.37)
//
// Safaricom calls the QueueTimeOutURL when a payout request timed out in its
// queue. That is NOT a failure: the payout may still be processed, and the
// ResultURL callback remains the answer. The timeout used to go to the result
// endpoint, where a non-zero code refunded the reserve: a paid-out withdrawal
// could be refunded (double pay). This endpoint never settles anything: it
// verifies the source, records the timeout on the withdrawal, and leaves it
// 'processing' for the result callback (or an operator after checking with
// Safaricom).
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { parseMpesaB2CResult } from '@/lib/payments/mpesa'
import { verifyMpesaWebhookSource } from '@/lib/payments/mpesa-webhook-verify'

const ACCEPTED = { ResultCode: 0, ResultDesc: 'Accepted' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  try {
    const source = verifyMpesaWebhookSource(req, { requireToken: true })
    if (!source.ok || !source.enforced) {
      return NextResponse.json({ ResultCode: 1, ResultDesc: 'Rejected: source verification failed' },
        { status: source.reason === 'ip_not_allowed' ? 403 : 401 })
    }
    const body = await req.json().catch(() => ({}))
    const r = parseMpesaB2CResult(body)
    const admin = await createAdminClient()

    let withdrawalId: string | null = null
    if (r.conversationId) {
      const { data } = await admin.from('withdrawals').select('id').eq('provider_reference', r.conversationId).maybeSingle()
      withdrawalId = (data as { id: string } | null)?.id ?? null
    }
    if (!withdrawalId && r.originatorConversationId && UUID_RE.test(r.originatorConversationId)) {
      const { data } = await admin.from('withdrawals').select('id')
        .eq('id', r.originatorConversationId).eq('provider', 'mpesa').maybeSingle()
      withdrawalId = (data as { id: string } | null)?.id ?? null
    }
    if (!withdrawalId) {
      console.warn('M-Pesa B2C queue timeout: withdrawal not found', r.conversationId ?? r.originatorConversationId ?? '(none)')
      return NextResponse.json(ACCEPTED)
    }
    console.warn('M-Pesa B2C queue timeout: left processing for the result callback', withdrawalId)
    await admin.rpc('note_withdrawal_status_check' as never, {
      p_withdrawal_id: withdrawalId,
      p_result: { verdict: 'mpesa_queue_timeout', result_code: r.resultCode, result_desc: r.resultDesc || null },
    } as never)
    return NextResponse.json(ACCEPTED)
  } catch (error) {
    console.error('M-Pesa B2C timeout webhook error:', error)
    return NextResponse.json(ACCEPTED)
  }
}
