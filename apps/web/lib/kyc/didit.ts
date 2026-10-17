// lib/kyc/didit.ts — the Didit identity-verification vendor, server side only.
//
// Didit runs the checks a human reviewer looking at a JPEG cannot: document
// authenticity and MRZ checksums, passive liveness, face match against the
// document portrait, IP analysis, and on the KYC+AML workflow sanctions and PEP
// screening. We send a user to a hosted session and receive a decision.
//
// This module holds the HTTP edge and, deliberately, the pure functions around
// it (status mapping, identity extraction, media stripping, signature
// verification). Those are where the bugs live and they are the parts a test
// can reach without a network.
//
// THE API KEY NEVER LEAVES THIS FILE'S REQUESTS. It is read from the
// environment at call time, is never interpolated into a log line, and no
// function here returns it. Errors are raised with the status code and the
// vendor's own message, never with the request headers.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { alpha2, alpha3 } from '@/lib/kyc/iso-country'

const BASE = 'https://verification.didit.me'

/** Didit's own session vocabulary, verbatim and case-sensitive. */
export type DiditStatus =
  | 'Not Started'
  | 'In Progress'
  | 'Awaiting User'
  | 'In Review'
  | 'Approved'
  | 'Declined'
  | 'Resubmitted'
  | 'Abandoned'
  | 'Expired'
  | 'Kyc Expired'

export type KycStatus = 'unverified' | 'pending' | 'verified' | 'rejected'

export interface DiditSession {
  session_id: string
  url: string
  status: DiditStatus
  workflow_id: string
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
// Read at call time, not at module load. A module-level read is evaluated
// during the Next build, where none of these exist, and bakes `undefined` into
// the bundle — the same class of failure that took elopis.com down on
// 2026-10-16 with the NEXT_PUBLIC_* build args.

function apiKey(): string {
  const v = process.env.DIDIT_API_KEY
  if (!v) throw new Error('DIDIT_API_KEY is not set')
  return v
}

export function workflowId(): string {
  const v = process.env.DIDIT_WORKFLOW_ID
  if (!v) throw new Error('DIDIT_WORKFLOW_ID is not set')
  return v
}

/** Present only when the webhook destination has been configured in the Didit console. */
export function webhookSecret(): string | null {
  return process.env.DIDIT_WEBHOOK_SECRET || null
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'x-api-key': apiKey(),
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  })
  const text = await res.text()
  if (!res.ok) {
    // The body, not the request: a Didit error names the offending field, and
    // the request would carry the key.
    throw new Error(`Didit ${init?.method ?? 'GET'} ${path} failed: ${res.status} ${text.slice(0, 300)}`)
  }
  return text ? (JSON.parse(text) as T) : ({} as T)
}

export interface CreateSessionInput {
  /** Our user id. Didit keys duplicate detection and session reuse on this. */
  vendorData: string
  /** Where Didit returns the user when they finish or abandon. */
  callback: string
  /**
   * What the user told us. Didit compares these against what it reads off the
   * document, which is the whole reason we still ask for a name and a date of
   * birth rather than letting OCR be the only source.
   *
   * Countries go in as ALPHA-2, the form our schema and country pickers use.
   * createSession converts them: Didit rejects alpha-2 outright with
   * "Invalid ISO 3166-1 alpha-3 country code for country", which is a 400 on
   * every single session and therefore a verification flow that never opens.
   */
  expected?: {
    first_name?: string
    last_name?: string
    date_of_birth?: string
    /** ISO 3166-1 alpha-2, e.g. "KE". */
    country?: string
    /** ISO 3166-1 alpha-2 of the document's issuer. */
    id_country?: string
  }
  contact?: { email?: string; phone?: string }
  language?: string
}

/**
 * Create a session, or get back the one already in flight.
 *
 * Didit returns the EXISTING unfinished session for a vendor_data rather than
 * opening a second one, which is the behaviour we want and the reason the
 * caller may treat this as idempotent. It is still worth storing the id: a
 * session costs money, and asking Didit on every page load to find out whether
 * one exists is a round trip for something we already know.
 */
export async function createSession(input: CreateSessionInput): Promise<DiditSession> {
  const body: Record<string, unknown> = {
    workflow_id: workflowId(),
    vendor_data: input.vendorData,
    callback: input.callback,
  }
  if (input.expected) {
    const e = input.expected
    // Drop empty strings as well as undefined: Didit validates every key it
    // is given, and an empty `date_of_birth` is a 400, not an omission.
    const expected = Object.fromEntries(
      Object.entries({
        first_name: e.first_name,
        last_name: e.last_name,
        date_of_birth: e.date_of_birth,
        country: alpha3(e.country),
        id_country: alpha3(e.id_country),
      }).filter(([, v]) => typeof v === 'string' && v.length > 0),
    )
    if (Object.keys(expected).length) body.expected_details = expected
  }
  if (input.contact && Object.keys(input.contact).length) body.contact_details = input.contact
  if (input.language) body.language = input.language

  return call<DiditSession>('/v3/session/', { method: 'POST', body: JSON.stringify(body) })
}

/** The full decision, including every per-check result. Rate limit: 600/min. */
export async function fetchDecision(sessionId: string): Promise<Record<string, unknown>> {
  return call<Record<string, unknown>>(`/v3/session/${sessionId}/decision/`)
}

// ---------------------------------------------------------------------------
// Webhook signatures
// ---------------------------------------------------------------------------

/** Keys whose values are presigned media URLs or base64 images. See stripMedia. */
const MEDIA_KEYS = new Set([
  'portrait_image', 'front_image', 'back_image', 'full_front_image', 'full_back_image',
  'reference_image', 'source_image', 'target_image', 'video_url',
])

/**
 * Remove every media link before the payload is stored.
 *
 * Didit's media URLs are presigned and short-lived. Persisting one buys a dead
 * link and the false impression that we hold the evidence. The session id is
 * the durable handle; a reviewer opening a case fetches fresh links through
 * it. Keeping images out of our database is also the cheapest way to satisfy
 * DPA 2019 storage limitation: we hold the decision, not the photographs.
 */
export function stripMedia(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMedia)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (MEDIA_KEYS.has(k)) continue
      out[k] = stripMedia(v)
    }
    return out
  }
  return value
}

/**
 * Canonical JSON as Didit's X-Signature-V2 defines it: keys sorted at every
 * level, no whitespace, non-ASCII left as-is.
 *
 * Python's `json.dumps(..., sort_keys=True, separators=(',', ':'),
 * ensure_ascii=False)` is the reference. JSON.stringify already matches on
 * separators and on escaping, so the only work is ordering keys, which
 * JSON.stringify does not do.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function hmac(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex')
}

/** Constant-time compare that does not leak length through an early return. */
function sameSignature(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8')
  const y = Buffer.from(b, 'utf8')
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}

export interface WebhookVerification {
  ok: boolean
  reason?: string
}

/**
 * Verify a Didit webhook.
 *
 * Two signatures are accepted, in this order:
 *   X-Signature-V2  HMAC of the canonical JSON. Survives any re-encoding.
 *   X-Signature     HMAC of the raw bytes. Exact, and Next's request.text()
 *                   gives us the raw bytes, so it is the stronger of the two
 *                   here — but it is checked second because a body we failed
 *                   to canonicalise identically should not be the only reason
 *                   a genuine delivery is dropped.
 *
 * X-Signature-Simple is deliberately NOT accepted. It signs only
 * "{timestamp}:{session_id}:{status}:{webhook_type}" and therefore does not
 * cover the decision body at all: an attacker who saw one delivery could
 * replay its envelope with a different `decision` attached and we would verify
 * it. Didit deprecates it; a KYC decision is exactly the payload that must not
 * be accepted on a signature that does not cover it.
 *
 * `timestampSkewSeconds` is Didit's stated 5-minute replay window.
 */
export function verifyWebhook(
  rawBody: string,
  headers: { signatureV2?: string | null; signature?: string | null; timestamp?: string | null },
  secret: string,
  now: number = Math.floor(Date.now() / 1000),
  timestampSkewSeconds = 300,
): WebhookVerification {
  const ts = Number(headers.timestamp)
  if (!headers.timestamp || !Number.isFinite(ts)) return { ok: false, reason: 'missing timestamp' }
  if (Math.abs(now - ts) > timestampSkewSeconds) return { ok: false, reason: 'timestamp outside replay window' }

  if (headers.signatureV2) {
    let canonical: string
    try {
      canonical = canonicalJson(JSON.parse(rawBody))
    } catch {
      return { ok: false, reason: 'body is not JSON' }
    }
    if (sameSignature(headers.signatureV2, hmac(secret, canonical))) return { ok: true }
  }
  if (headers.signature && sameSignature(headers.signature, hmac(secret, rawBody))) {
    return { ok: true }
  }
  return { ok: false, reason: 'signature mismatch' }
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/**
 * Didit's status to ours.
 *
 * `null` means "this is not a decision": the journey is still moving, or it
 * ended without one. Those events update the draft so the UI can show where
 * the user is, and must NOT touch profiles.kyc_status — flipping a profile to
 * `pending` the moment someone opens the camera would show them the "under
 * review" screen and strand them mid-scan, because /kyc routes `pending` to a
 * terminal state.
 *
 * `Kyc Expired` is a verification that has aged out of its validity period,
 * not a failed one. It returns the user to unverified so they can re-verify;
 * it is not a rejection and must not read as one.
 */
export function mapStatus(status: string): KycStatus | null {
  switch (status) {
    case 'Approved':
      return 'verified'
    case 'Declined':
      return 'rejected'
    case 'In Review':
      return 'pending'
    case 'Kyc Expired':
      return 'unverified'
    default:
      return null
  }
}

/** True when the user can no longer act on this session and needs a new one. */
export function isDeadSession(status: string): boolean {
  return status === 'Abandoned' || status === 'Expired' || status === 'Declined' || status === 'Kyc Expired'
}

const DOC_TYPE_MAP: Record<string, string> = {
  'Identity Card': 'national_id',
  'ID Card': 'national_id',
  Passport: 'passport',
  'Driver’s License': 'drivers_license',
  "Driver's License": 'drivers_license',
  'Driving Licence': 'drivers_license',
  'Residence Permit': 'residence_permit',
}

export interface ExtractedIdentity {
  documentType: string | null
  documentNumber: string | null
  dateOfBirth: string | null
  country: string | null
  expiry: string | null
  fullName: string | null
}

/**
 * Pull the identity fields out of a decision.
 *
 * Every feature block is a plural ARRAY or null, never an object, and is null
 * rather than empty when the workflow did not run that feature. Reading
 * `decision.id_verification.document_number` (singular, as the v2 docs showed)
 * yields undefined against the v3 shape and writes a row with no document
 * number at all, silently.
 *
 * Dates are returned as-is for the database to validate: a vendor date that
 * does not parse should fail the insert loudly, not be coerced to null here
 * and quietly lose the one field the 18+ rule turns on.
 */
export function extractIdentity(decision: Record<string, unknown>): ExtractedIdentity {
  const ids = decision.id_verifications
  const first = Array.isArray(ids) && ids.length ? (ids[0] as Record<string, unknown>) : null
  const str = (k: string): string | null => {
    const v = first?.[k]
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }
  const rawType = str('document_type')
  return {
    documentType: rawType ? (DOC_TYPE_MAP[rawType] ?? rawType.toLowerCase().replace(/\s+/g, '_')) : null,
    documentNumber: str('document_number'),
    dateOfBirth: str('date_of_birth'),
    // `issuing_state` comes back as ISO alpha-3 ("KEN"); our column is
    // CHAR(2). Converted through the real table, never truncated: "KEN" to
    // "KE" is right by luck, "DEU" to "DE" is not.
    country: alpha2(str('issuing_state')),
    expiry: str('expiration_date'),
    fullName: str('full_name') ?? ([str('first_name'), str('last_name')].filter(Boolean).join(' ') || null),
  }
}

export interface CheckSummary {
  label: string
  status: string
  /** 0..1 or 0..100 depending on the check; Didit is not consistent, so it is shown, not compared. */
  score: number | null
}

/**
 * What each check concluded, for the reviewer queue.
 *
 * A reviewer opening a flagged case needs to know which of four checks
 * objected before they decide anything. Without this the queue shows a status
 * and a document number, which is exactly as much as the old manual flow gave
 * them and none of what the vendor actually found.
 *
 * Scores are rendered, never thresholded here: Didit's own examples show
 * liveness as both 0.98 and 89.92, so the scale is not safe to compare against
 * a constant.
 */
export function summariseChecks(decision: Record<string, unknown>): CheckSummary[] {
  const blocks: [string, string][] = [
    ['id_verifications', 'Document'],
    ['liveness_checks', 'Liveness'],
    ['face_matches', 'Face match'],
    ['aml_screenings', 'AML'],
  ]
  const out: CheckSummary[] = []
  for (const [key, label] of blocks) {
    const arr = decision[key]
    if (!Array.isArray(arr) || !arr.length) continue
    const first = arr[0] as Record<string, unknown>
    out.push({
      label,
      status: typeof first.status === 'string' ? first.status : 'Unknown',
      score: typeof first.score === 'number' ? first.score : null,
    })
  }
  return out
}

/**
 * A reason a person can act on, assembled from the checks that actually
 * failed. Didit's own warnings are written for an integrator; a user needs to
 * know whether to retake a photo or contact support.
 */
export function declineReason(decision: Record<string, unknown>): string {
  const failed: string[] = []
  const check = (key: string, label: string) => {
    const arr = decision[key]
    if (Array.isArray(arr) && arr.some((r) => (r as Record<string, unknown>)?.status === 'Declined')) {
      failed.push(label)
    }
  }
  check('id_verifications', 'the document could not be verified')
  check('liveness_checks', 'the selfie did not pass the liveness check')
  check('face_matches', 'the selfie did not match the document photo')
  check('aml_screenings', 'a compliance screening flagged the details')

  if (!failed.length) return 'We could not verify your identity. You can try again.'
  return `We could not verify your identity: ${failed.join(', ')}.`
}
