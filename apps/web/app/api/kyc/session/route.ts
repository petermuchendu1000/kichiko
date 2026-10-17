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

  // THE PHONE HAS TO REACH THE PROFILE.
  //
  // The six-step wizard wrote `profiles.phone_number` on submit. Replacing it
  // with the Didit handoff removed that write, and the phone then lived only
  // in the draft, which is deleted the moment a decision lands.
  // `enqueue_notification_deliveries()` reads the profile column to address an
  // SMS, so every user verifying through the new flow would have ended up with
  // no phone on file and no deposit or payout SMS ever sent to them.
  //
  // Written here, at the point they commit to the check, rather than on
  // approval: the number is theirs either way, and a verification that stalls
  // should not also cost them their notifications. The database normalises it
  // to E.164 on write (migration 125).
  if (draft.data.phone.trim()) {
    const { error: phoneErr } = await admin
      .from('profiles')
      .update({ phone_number: draft.data.phone.trim() })
      .eq('id', user.id)
    // Non-fatal, and deliberately not surfaced: phone_number is UNIQUE, so a
    // number already on another account fails here. That is worth a log and a
    // look, but it is not a reason to block somebody's identity check.
    if (phoneErr) console.warn('could not store phone on profile', { reason: phoneErr.message })
  }

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
    // NO DRAFT IS NOT THE SAME AS NO ANSWER.
    //
    // apply_didit_decision() deletes the draft once a decision lands, and the
    // webhook and this poll race to be the one that applies it. When the
    // webhook wins, the next poll found no draft, returned nulls, and the
    // wizard sat on "checking your result" against a user who was already
    // verified — with a "Start ID check" button inviting them to pay for a
    // second session. Reported from a real run.
    //
    // So when the draft is gone, answer from the record the decision left
    // behind instead of from its absence.
    // provider_status arrives with migration 123 and is not in
    // types/supabase.ts yet, so the row shape is stated rather than inferred
    // (see draftsClient above for why regeneration is still pending).
    const { data } = await supabase
      .from('kyc_documents')
      .select('status, provider_status, rejection_reason')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const doc = data as unknown as {
      status: 'unverified' | 'pending' | 'verified' | 'rejected'
      provider_status: string | null
      rejection_reason: string | null
    } | null

    if (doc?.status) {
      return NextResponse.json({
        providerStatus: doc.provider_status ?? null,
        kycStatus: doc.status,
        reason: doc.rejection_reason ?? null,
      })
    }
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
