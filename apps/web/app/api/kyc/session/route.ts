// app/api/kyc/session/route.ts — open a Didit verification session, and read
// back what became of it.
//
// POST  start (or re-open) this user's session, answer with the hosted URL
// GET   what Didit currently says, applying the decision if there is one
//
// The user never talks to Didit's API, only to its hosted page. Everything
// authenticated happens here, because the API key verifies anyone who holds
// it: a key in the browser is an account anyone can verify.
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/server'
import { createSession, isDeadSession } from '@/lib/kyc/didit'
import { syncSession } from '@/lib/kyc/didit-sync'
import { canonicalOrigin } from '@/lib/http/origin'
import { loadDraft, canStartVerification } from '@/lib/kyc/draft'

export const dynamic = 'force-dynamic'

/**
 * `kyc_drafts` (migration 121) and its Didit columns (123) are not in
 * types/supabase.ts: regeneration needs a direct Postgres connection on 5432,
 * which this environment does not have, and the Management API shim collapses
 * same-named columns across tables so it emitted 64 of 108 tables. Until that
 * is done the table is reached through an untyped client rather than by
 * sprinkling `as never` over each column.
 */
async function draftsClient(): Promise<SupabaseClient> {
  return (await createAdminClient()) as unknown as SupabaseClient
}

/** Where Didit sends the user when the hosted flow ends, either way. */
function callbackUrl(): string {
  // canonicalOrigin, never the forwarded host: this URL is handed to a third
  // party who will later walk a real user to it. See lib/http/origin.ts.
  return `${canonicalOrigin()}/kyc?from=didit`
}

export async function POST() {
  const guard = await requireUser()
  if (!guard.ok) return guard.response
  const { user, supabase } = guard.ctx

  // Read the draft as the USER, through RLS. The admin client is used only for
  // the two columns the browser is not allowed to write.
  const draft = await loadDraft(supabase, user.id)
  if (!draft || !canStartVerification(draft)) {
    return NextResponse.json(
      { error: 'Complete your details and address first' },
      { status: 400 },
    )
  }

  // An existing session that is still usable is reused rather than replaced.
  // Didit charges per session and returns the same one for a vendor_data with
  // an unfinished journey anyway; this just saves the round trip and keeps the
  // URL stable across a refresh.
  if (draft.didit.sessionUrl && draft.didit.sessionId && !isDeadSession(draft.didit.status ?? '')) {
    return NextResponse.json({ url: draft.didit.sessionUrl, sessionId: draft.didit.sessionId })
  }

  let session
  try {
    session = await createSession({
      vendorData: user.id,
      callback: callbackUrl(),
      expected: {
        first_name: draft.data.firstName.trim(),
        last_name: draft.data.lastName.trim(),
        date_of_birth: draft.data.dateOfBirth,
        country: draft.data.addrCountry,
      },
      contact: { email: user.email ?? undefined, phone: draft.data.phone.trim() || undefined },
    })
  } catch (err) {
    // The vendor's message can name a misconfigured workflow or a rejected
    // field, which is worth having in the server log. It never carries the key.
    console.error('Didit session creation failed', err)
    return NextResponse.json({ error: 'Verification is unavailable right now' }, { status: 502 })
  }

  const admin = await draftsClient()
  await admin
    .from('kyc_drafts')
    .update({
      didit_session_id: session.session_id,
      didit_session_url: session.url,
      didit_status: session.status,
    })
    .eq('user_id', user.id)

  return NextResponse.json({ url: session.url, sessionId: session.session_id })
}

export async function GET() {
  const guard = await requireUser()
  if (!guard.ok) return guard.response
  const { user, supabase } = guard.ctx

  const draft = await loadDraft(supabase, user.id)
  if (!draft?.didit.sessionId) {
    return NextResponse.json({ providerStatus: null, kycStatus: null })
  }

  try {
    const admin = await draftsClient()
    // Authoritative: re-read the decision from Didit rather than believing the
    // `?from=didit` the browser arrived with. A query string is not evidence.
    const result = await syncSession(admin, user.id, draft.didit.sessionId)
    return NextResponse.json(result)
  } catch (err) {
    console.error('Didit status check failed', err)
    // Answer with what we already knew rather than an error the wizard would
    // have to render: a failed poll should look like "not yet", not like a
    // broken page.
    return NextResponse.json({ providerStatus: draft.didit.status, kycStatus: null, reason: null })
  }
}
