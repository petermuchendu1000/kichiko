// lib/kyc/draft.ts
// ---------------------------------------------------------------------------
// Save / resume for the KYC wizard.
//
// The shape the wizard holds, the rules for what counts as a finished step,
// and the read-write pair against `kyc_drafts` (migrations 121, 123). Kept out
// of the component so the step rules are testable without rendering anything.
//
// WHAT CHANGED WHEN DIDIT ARRIVED (migration 123)
// The wizard used to have six steps, three of which existed to collect
// evidence by hand: document type and number, front and back photographs, a
// selfie. Didit's hosted flow does all of that, reads the document itself, and
// checks the face against it, so those steps are gone and with them the
// storage uploads and the `*_path` fields.
//
// What is left is what Didit does NOT do: a legal name and date of birth to
// check its OCR against, a phone number for payouts, and a residential address
// (neither KYC workflow includes proof of address). Three steps, then the
// handoff.
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Everything the wizard collects. One flat object because it is written and
 * read whole, never queried.
 *
 * The name is collected as two fields and is the LEGAL name, not
 * `profiles.display_name`: a display name is "trader99", and sending it to
 * Didit as an expected first name would fail every honest user's document
 * check. It exists so Didit can compare what the user claims against what it
 * reads off the document, which is the only reason to ask for something a
 * scanner could read for us.
 */
export interface KycDraftData {
  firstName: string
  lastName: string
  phone: string
  dateOfBirth: string
  addrLine1: string
  addrCity: string
  addrPostal: string
  addrCountry: string
}

/** The vendor session attached to this journey, if one has been opened. */
export interface DiditDraftState {
  sessionId: string | null
  sessionUrl: string | null
  status: string | null
}

export interface KycDraft {
  currentStep: number
  data: KycDraftData
  didit: DiditDraftState
  updatedAt: string | null
}

/** Step indices, named. The wizard renders these in order. */
export const STEP = {
  identity: 0,
  address: 1,
  verify: 2,
} as const

export const STEP_COUNT = 3

export function emptyDraft(phone = '', country = 'KE'): KycDraft {
  return {
    currentStep: 0,
    data: {
      firstName: '',
      lastName: '',
      phone,
      dateOfBirth: '',
      addrLine1: '',
      addrCity: '',
      addrPostal: '',
      addrCountry: country || 'KE',
    },
    didit: { sessionId: null, sessionUrl: null, status: null },
    updatedAt: null,
  }
}

/**
 * Age in whole years on `today`.
 *
 * Done by calendar parts rather than by dividing a millisecond difference:
 * a year is not a fixed number of milliseconds, and the naive version puts
 * someone born on 29 February a day the wrong side of their birthday. On an
 * 18+ rule, being wrong by a day is the whole question.
 */
export function ageOn(dob: string, today: Date = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const parsed = new Date(Date.UTC(y, mo - 1, d))
  // Rejects 2026-02-30 and friends, which Date would silently roll forward.
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== mo - 1 || parsed.getUTCDate() !== d) {
    return null
  }
  let age = today.getFullYear() - y
  const beforeBirthday =
    today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)
  if (beforeBirthday) age -= 1
  return age
}

export const MIN_AGE = 18

export function isAdult(dob: string, today: Date = new Date()): boolean {
  const age = ageOn(dob, today)
  return age !== null && age >= MIN_AGE && age <= 120
}

/** Didit statuses that mean the session has run and produced something. */
const DECIDED = new Set(['Approved', 'In Review', 'Declined'])

/**
 * Is each step complete?
 *
 * The verify step is complete once Didit has something to say. "In Progress"
 * is not complete: a user who opened the camera and walked away has not
 * verified, and must land back on this step rather than on a summary telling
 * them they are done.
 */
export function stepComplete(draft: KycDraft, step: number): boolean {
  const d = draft.data
  switch (step) {
    case STEP.identity:
      return (
        d.firstName.trim().length > 1 &&
        d.lastName.trim().length > 1 &&
        /^[+]?[\d\s-]{7,}$/.test(d.phone.trim()) &&
        isAdult(d.dateOfBirth)
      )
    case STEP.address:
      return d.addrLine1.trim().length > 2 && d.addrCity.trim().length > 1
    case STEP.verify:
      return !!draft.didit.status && DECIDED.has(draft.didit.status)
    default:
      return false
  }
}

/** The first step that is not yet complete. Where a resumed journey lands. */
export function firstIncompleteStep(draft: KycDraft): number {
  for (let s = 0; s < STEP_COUNT; s++) if (!stepComplete(draft, s)) return s
  return STEP.verify
}

/** Everything Didit needs from us is present, so a session may be opened. */
export function canStartVerification(draft: KycDraft): boolean {
  return stepComplete(draft, STEP.identity) && stepComplete(draft, STEP.address)
}

/* ------------------------------------------------------------------------ */
/* Persistence                                                               */
/* ------------------------------------------------------------------------ */

interface DraftRow {
  current_step: number
  data: Partial<KycDraftData> | null
  didit_session_id: string | null
  didit_session_url: string | null
  didit_status: string | null
  updated_at: string | null
}

const COLS = 'current_step, data, didit_session_id, didit_session_url, didit_status, updated_at'

/**
 * Read this user's draft, or null when there is none.
 *
 * Merged over `emptyDraft` rather than used raw: a draft written by an older
 * version of the wizard is missing whatever fields have been added since, and
 * `undefined` reaching a controlled input turns it into an uncontrolled one.
 * Drafts written before migration 123 carry document fields that no longer
 * exist here; the merge drops them without complaint, which is what should
 * happen to a half-finished journey whose steps have been deleted.
 */
export async function loadDraft(
  supabase: SupabaseClient,
  userId: string,
  fallbackPhone = '',
  fallbackCountry = 'KE',
): Promise<KycDraft | null> {
  const { data, error } = await supabase
    .from('kyc_drafts')
    .select(COLS)
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as unknown as DraftRow
  const base = emptyDraft(fallbackPhone, fallbackCountry)
  const merged = { ...base.data, ...(row.data ?? {}) }
  return {
    currentStep: row.current_step ?? 0,
    // Only the keys this version knows about. A stale `docNumber` riding along
    // in `data` would be written straight back on the next save.
    data: Object.fromEntries(
      Object.keys(base.data).map((k) => [k, (merged as Record<string, unknown>)[k] ?? '']),
    ) as unknown as KycDraftData,
    didit: {
      sessionId: row.didit_session_id,
      sessionUrl: row.didit_session_url,
      status: row.didit_status,
    },
    updatedAt: row.updated_at,
  }
}

/**
 * Write the draft. Upsert on the primary key, so advancing is idempotent.
 *
 * The Didit columns are NOT written here. They are set by the server when a
 * session is opened and by the webhook as it progresses, and a browser that
 * could write them could write itself an approved status.
 */
export async function saveDraft(
  supabase: SupabaseClient,
  userId: string,
  draft: KycDraft,
): Promise<boolean> {
  const { error } = await supabase.from('kyc_drafts').upsert(
    {
      user_id: userId,
      current_step: draft.currentStep,
      data: draft.data,
    },
    { onConflict: 'user_id' },
  )
  return !error
}

/** Drop the draft once a real submission exists. */
export async function clearDraft(supabase: SupabaseClient, userId: string): Promise<void> {
  await supabase.from('kyc_drafts').delete().eq('user_id', userId)
}

/** "Saved 3 minutes ago" for the resume banner. */
export function savedAgo(updatedAt: string | null, now: Date = new Date()): string | null {
  if (!updatedAt) return null
  const then = new Date(updatedAt).getTime()
  if (Number.isNaN(then)) return null
  const mins = Math.floor((now.getTime() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
