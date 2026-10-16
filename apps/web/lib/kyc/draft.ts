// lib/kyc/draft.ts
// ---------------------------------------------------------------------------
// Save / resume for the KYC wizard.
//
// The shape the wizard holds, the rules for what counts as a finished step,
// and the read-write pair against `kyc_drafts` (migration 121). Kept out of
// the component so the step rules are testable without rendering anything:
// "is this step done" is the logic that decides whether someone is asked for
// their ID photo a second time, and it should not only be exercised by a
// browser.
import type { SupabaseClient } from '@supabase/supabase-js'

/** Kenya-first, matching the ID types Smile ID resolves against IPRS/e-citizen. */
export type DocType = 'national_id' | 'passport' | 'drivers_license' | 'alien_card'

/**
 * Everything the wizard collects EXCEPT the files themselves, which live in
 * storage and are referenced by path. One flat object because it is written
 * and read whole, never queried.
 */
export interface KycDraftData {
  phone: string
  dateOfBirth: string
  docType: DocType
  docNumber: string
  idCountry: string
  expiry: string
  addrLine1: string
  addrCity: string
  addrPostal: string
  addrCountry: string
}

export interface KycDraft {
  currentStep: number
  data: KycDraftData
  frontPath: string | null
  backPath: string | null
  selfiePath: string | null
  updatedAt: string | null
}

export const STEP_COUNT = 6

/** Step indices, named. The wizard renders these in order. */
export const STEP = {
  email: 0,
  identity: 1,
  document: 2,
  selfie: 3,
  address: 4,
  review: 5,
} as const

export function emptyDraft(phone = '', country = 'KE'): KycDraft {
  return {
    currentStep: 0,
    data: {
      phone,
      dateOfBirth: '',
      docType: 'national_id',
      docNumber: '',
      idCountry: country || 'KE',
      expiry: '',
      addrLine1: '',
      addrCity: '',
      addrPostal: '',
      addrCountry: country || 'KE',
    },
    frontPath: null,
    backPath: null,
    selfiePath: null,
    updatedAt: null,
  }
}

/** Which document types have a meaningful reverse side. */
export function needsBack(docType: DocType): boolean {
  return docType === 'national_id' || docType === 'drivers_license' || docType === 'alien_card'
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

/**
 * Is each step complete?
 *
 * The document and selfie steps are satisfied by a stored PATH, not by a File
 * in memory. That is the whole point of resuming: someone who uploaded their
 * ID yesterday on a phone must not be asked for it again today on a laptop,
 * where the file object does not exist.
 */
export function stepComplete(draft: KycDraft, step: number): boolean {
  const d = draft.data
  switch (step) {
    case STEP.email:
      return true
    case STEP.identity:
      return /^[+]?[\d\s-]{7,}$/.test(d.phone.trim()) && isAdult(d.dateOfBirth)
    case STEP.document:
      return (
        d.docNumber.trim().length > 2 &&
        !!draft.frontPath &&
        (!needsBack(d.docType) || !!draft.backPath)
      )
    case STEP.selfie:
      return !!draft.selfiePath
    case STEP.address:
      return d.addrLine1.trim().length > 2 && d.addrCity.trim().length > 1
    case STEP.review:
      return true
    default:
      return false
  }
}

/** The first step that is not yet complete. Where a resumed journey lands. */
export function firstIncompleteStep(draft: KycDraft): number {
  for (let s = 0; s < STEP_COUNT; s++) if (!stepComplete(draft, s)) return s
  return STEP.review
}

/** Everything before `review` is done, so the submission is allowed. */
export function canSubmit(draft: KycDraft): boolean {
  return [STEP.identity, STEP.document, STEP.selfie, STEP.address].every((s) =>
    stepComplete(draft, s),
  )
}

/* ------------------------------------------------------------------------ */
/* Persistence                                                               */
/* ------------------------------------------------------------------------ */

interface DraftRow {
  current_step: number
  data: Partial<KycDraftData> | null
  front_path: string | null
  back_path: string | null
  selfie_path: string | null
  updated_at: string | null
}

/**
 * Read this user's draft, or null when there is none.
 *
 * Merged over `emptyDraft` rather than used raw: a draft written by an older
 * version of the wizard is missing whatever fields have been added since, and
 * `undefined` reaching a controlled input turns it into an uncontrolled one.
 */
export async function loadDraft(
  supabase: SupabaseClient,
  userId: string,
  fallbackPhone = '',
  fallbackCountry = 'KE',
): Promise<KycDraft | null> {
  const { data, error } = await supabase
    .from('kyc_drafts')
    .select('current_step, data, front_path, back_path, selfie_path, updated_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as DraftRow
  const base = emptyDraft(fallbackPhone, fallbackCountry)
  return {
    currentStep: row.current_step ?? 0,
    data: { ...base.data, ...(row.data ?? {}) },
    frontPath: row.front_path,
    backPath: row.back_path,
    selfiePath: row.selfie_path,
    updatedAt: row.updated_at,
  }
}

/** Write the draft. Upsert on the primary key, so advancing is idempotent. */
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
      front_path: draft.frontPath,
      back_path: draft.backPath,
      selfie_path: draft.selfiePath,
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
