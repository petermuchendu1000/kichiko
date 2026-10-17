// lib/kyc/didit-sync.ts — turn a Didit session state into our KYC state.
//
// ONE PATH, TWO DOORS. The webhook and the browser poll both land here.
//
// A webhook alone is not enough. It can be mis-configured, its secret can be
// rotated out from under us, a deploy can be mid-rollout when it fires, and
// Didit gives up retrying eventually. Any of those leaves a user who has
// genuinely passed sitting on "we are checking" forever, which is the failure
// they will tell support about.
//
// So the page the user returns to also asks, and that poll is authoritative in
// exactly the same way: it does not trust a query string, it re-reads the
// decision from Didit with our API key and applies it through the same
// function. The webhook is the fast path, not the only one. If they race,
// `apply_didit_decision` upserts on the session id and the second one is a
// no-op with the same values.
import { fetchDecision, mapStatus, stripMedia, extractIdentity, declineReason } from '@/lib/kyc/didit'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface SyncResult {
  /** Didit's own word for it, for the UI and the reviewer queue. */
  providerStatus: string
  /** Ours, or null when this was not a decision and nothing was applied. */
  kycStatus: 'unverified' | 'pending' | 'verified' | 'rejected' | null
  reason: string | null
}

/**
 * Read a session's current decision and apply it.
 *
 * `admin` must be a service-role client: `apply_didit_decision` is granted to
 * service_role alone, because a function that writes `kyc_status = verified`
 * is one a user must never be able to call.
 */
export async function syncSession(
  admin: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<SyncResult> {
  const decision = await fetchDecision(sessionId)
  const providerStatus = typeof decision.status === 'string' ? decision.status : 'Unknown'
  const kycStatus = mapStatus(providerStatus)

  // The draft always learns the latest, decision or not: it is what lets the
  // wizard say "still scanning" instead of showing a dead button.
  await admin
    .from('kyc_drafts')
    .update({ didit_status: providerStatus })
    .eq('user_id', userId)

  if (!kycStatus) return { providerStatus, kycStatus: null, reason: null }

  const identity = extractIdentity(decision)
  const reason = kycStatus === 'rejected' ? declineReason(decision) : null

  const { error } = await admin.rpc('apply_didit_decision', {
    p_user_id: userId,
    p_session_id: sessionId,
    p_status: kycStatus,
    p_provider_status: providerStatus,
    // Media URLs are presigned and expire; see stripMedia.
    p_decision: stripMedia(decision) as never,
    p_reason: reason,
    p_document_type: identity.documentType,
    p_document_number: identity.documentNumber,
    p_date_of_birth: identity.dateOfBirth,
    p_country: identity.country,
    p_expiry: identity.expiry,
  } as never)

  if (error) throw new Error(`apply_didit_decision failed: ${error.message}`)
  return { providerStatus, kycStatus, reason }
}
