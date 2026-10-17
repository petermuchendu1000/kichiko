// app/api/webhooks/didit/route.ts — Didit tells us a verification moved.
//
// WHAT THIS HANDLER TRUSTS: the session id, and nothing else.
//
// The body carries a `status` and a whole `decision`. Acting on either would
// mean a forged POST can verify an account, which on this platform is the
// difference between a KYC gate and a decoration. So the handler takes only
// `session_id` and `vendor_data` from the payload, then re-reads the decision
// from Didit over TLS with our API key (lib/kyc/didit-sync.ts). The signature
// check below decides whether we bother; the re-read decides what is true.
//
// That also makes a replayed delivery harmless: re-reading a session that has
// not changed applies the same decision to the same row.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { verifyWebhook, webhookSecret } from '@/lib/kyc/didit'
import { syncSession } from '@/lib/kyc/didit-sync'

export const dynamic = 'force-dynamic'

/** Didit stops retrying on a 2xx. Used for anything we have deliberately ignored. */
const ACCEPTED = NextResponse.json({ received: true })

export async function POST(req: NextRequest) {
  const secret = webhookSecret()
  if (!secret) {
    // FAIL CLOSED. Without the shared key there is no way to tell Didit from
    // anyone who found this URL, and the one thing this endpoint can do is
    // mark an account verified. 503 rather than 200 so Didit keeps retrying
    // and the deliveries are still there once the secret is configured.
    console.error('Didit webhook received but DIDIT_WEBHOOK_SECRET is not set')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  // The RAW body, before any parsing: X-Signature covers the exact bytes, and
  // JSON.parse followed by JSON.stringify is not the same bytes.
  const raw = await req.text()

  const check = verifyWebhook(
    raw,
    {
      signatureV2: req.headers.get('x-signature-v2'),
      signature: req.headers.get('x-signature'),
      timestamp: req.headers.get('x-timestamp'),
    },
    secret,
  )
  if (!check.ok) {
    console.warn('Didit webhook rejected', { reason: check.reason })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : null
  const userId = typeof payload.vendor_data === 'string' ? payload.vendor_data : null

  // Entity, transaction and travel-rule events share this endpoint and carry
  // neither. They are not errors; they are simply not ours.
  if (!sessionId || !userId) return ACCEPTED

  try {
    const admin = await createAdminClient()

    // vendor_data is whatever we sent on create, which is the user's id — but
    // it arrives from outside, so it is checked against a real profile before
    // it is used as one. Without this, a signed event for a session we did not
    // create could name any id at all.
    const { data: profile } = await admin
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle()
    if (!profile) {
      console.warn('Didit webhook for unknown vendor_data', { sessionId })
      return ACCEPTED
    }

    const result = await syncSession(admin, userId, sessionId)
    console.info('Didit webhook applied', {
      sessionId,
      providerStatus: result.providerStatus,
      kycStatus: result.kycStatus,
    })
    return ACCEPTED
  } catch (err) {
    console.error('Didit webhook handling failed', err)
    // 500 so Didit retries. The alternative — swallowing it with a 200 — turns
    // a transient database error into a user who is verified at the vendor and
    // unverified here, with nothing left to replay.
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}
