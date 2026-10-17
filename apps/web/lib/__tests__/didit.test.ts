// lib/__tests__/didit.test.ts
// ---------------------------------------------------------------------------
// The parts of the Didit integration that decide whether an account gets
// verified, exercised without a network.
//
// Three of these guard against a specific way this goes wrong:
//   - a signature check that accepts a forged body,
//   - a decision parser reading the v2 shape against a v3 payload and silently
//     extracting nothing,
//   - a status map that flips a profile to `pending` mid-scan and strands the
//     user on the "under review" screen.
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import {
  canonicalJson,
  verifyWebhook,
  stripMedia,
  mapStatus,
  isDeadSession,
  extractIdentity,
  declineReason,
} from '../kyc/didit'
import { alpha2, alpha3 } from '../kyc/iso-country'

const SECRET = 'whsec_test_key'
const sign = (msg: string) => createHmac('sha256', SECRET).update(msg, 'utf8').digest('hex')

describe('canonicalJson', () => {
  it('sorts keys at every level and emits no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })

  it('keeps array order, which is data, not formatting', () => {
    expect(canonicalJson({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}')
  })

  it('leaves non-ASCII as characters (Didit signs with ensure_ascii=False)', () => {
    // ñ escaped here would produce a different HMAC from the one Didit
    // computed, and every delivery naming a non-ASCII document would fail.
    expect(canonicalJson({ name: 'Peña' })).toBe('{"name":"Peña"}')
  })

  it('drops undefined rather than emitting it as a value', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
  })
})

describe('verifyWebhook', () => {
  const body = JSON.stringify({ session_id: 's1', status: 'Approved', b: 2, a: 1 })
  const now = 1_800_000_000

  it('accepts a correct V2 signature over the canonical body', () => {
    const sig = sign(canonicalJson(JSON.parse(body)))
    expect(
      verifyWebhook(body, { signatureV2: sig, timestamp: String(now) }, SECRET, now).ok,
    ).toBe(true)
  })

  it('accepts a correct raw-body signature when V2 is absent', () => {
    expect(
      verifyWebhook(body, { signature: sign(body), timestamp: String(now) }, SECRET, now).ok,
    ).toBe(true)
  })

  it('rejects a body that was altered after signing', () => {
    const sig = sign(canonicalJson(JSON.parse(body)))
    const forged = JSON.stringify({ session_id: 's1', status: 'Approved', b: 2, a: 999 })
    expect(verifyWebhook(forged, { signatureV2: sig, timestamp: String(now) }, SECRET, now).ok).toBe(false)
  })

  it('rejects the wrong secret', () => {
    const sig = createHmac('sha256', 'other').update(body).digest('hex')
    expect(verifyWebhook(body, { signature: sig, timestamp: String(now) }, SECRET, now).ok).toBe(false)
  })

  it('rejects a replay outside the five-minute window, in both directions', () => {
    const sig = sign(body)
    expect(verifyWebhook(body, { signature: sig, timestamp: String(now - 301) }, SECRET, now).ok).toBe(false)
    expect(verifyWebhook(body, { signature: sig, timestamp: String(now + 301) }, SECRET, now).ok).toBe(false)
    expect(verifyWebhook(body, { signature: sig, timestamp: String(now - 299) }, SECRET, now).ok).toBe(true)
  })

  it('rejects a missing or unparseable timestamp rather than defaulting to now', () => {
    const sig = sign(body)
    expect(verifyWebhook(body, { signature: sig, timestamp: null }, SECRET, now).ok).toBe(false)
    expect(verifyWebhook(body, { signature: sig, timestamp: 'soon' }, SECRET, now).ok).toBe(false)
  })

  it('rejects a delivery carrying no signature at all', () => {
    expect(verifyWebhook(body, { timestamp: String(now) }, SECRET, now).ok).toBe(false)
  })

  it('falls through from a bad V2 to a good raw signature', () => {
    expect(
      verifyWebhook(body, { signatureV2: 'deadbeef', signature: sign(body), timestamp: String(now) }, SECRET, now).ok,
    ).toBe(true)
  })
})

describe('stripMedia', () => {
  it('removes presigned links and base64 images at any depth', () => {
    const decision = {
      status: 'Approved',
      id_verifications: [
        { document_number: 'A1', portrait_image: 'https://x/p.jpg', front_image: 'https://x/f.jpg' },
      ],
      liveness_checks: [{ score: 0.98, reference_image: 'https://x/r.jpg', video_url: 'https://x/v.mp4' }],
    }
    const out = stripMedia(decision) as Record<string, unknown>
    const json = JSON.stringify(out)
    expect(json).not.toContain('https://x/')
    // The evidence summary survives; only the links go.
    expect(json).toContain('A1')
    expect(json).toContain('0.98')
  })

  it('leaves primitives and nulls alone', () => {
    expect(stripMedia(null)).toBeNull()
    expect(stripMedia('x')).toBe('x')
    expect(stripMedia(3)).toBe(3)
  })
})

describe('mapStatus', () => {
  it('maps only real decisions', () => {
    expect(mapStatus('Approved')).toBe('verified')
    expect(mapStatus('Declined')).toBe('rejected')
    expect(mapStatus('In Review')).toBe('pending')
    expect(mapStatus('Kyc Expired')).toBe('unverified')
  })

  it('returns null mid-flight so a profile is never flipped to pending mid-scan', () => {
    // /kyc routes `pending` to a terminal "under review" screen. Mapping
    // "In Progress" to pending would show that to someone holding their ID up
    // to a camera, with no way back into the flow.
    for (const s of ['Not Started', 'In Progress', 'Awaiting User', 'Resubmitted', 'Abandoned', 'Expired']) {
      expect(mapStatus(s)).toBeNull()
    }
  })

  it('is case-sensitive, as Didit documents', () => {
    expect(mapStatus('approved')).toBeNull()
  })
})

describe('isDeadSession', () => {
  it('is true only when the user needs a new session', () => {
    expect(isDeadSession('Abandoned')).toBe(true)
    expect(isDeadSession('Expired')).toBe(true)
    expect(isDeadSession('Declined')).toBe(true)
    expect(isDeadSession('In Progress')).toBe(false)
    expect(isDeadSession('Approved')).toBe(false)
  })
})

describe('extractIdentity', () => {
  // v3 returns PLURAL ARRAYS. The v2 docs showed `id_verification` singular,
  // and reading that against this payload yields undefined for every field
  // while the insert still succeeds, so the row lands with no document number
  // and nobody notices.
  const decision = {
    status: 'Approved',
    id_verifications: [
      {
        document_type: 'Identity Card',
        document_number: ' 12345678 ',
        date_of_birth: '1995-06-15',
        issuing_state: 'ke',
        expiration_date: '2030-01-01',
        first_name: 'Amina',
        last_name: 'Wanjiru',
      },
    ],
  }

  it('reads the first verification out of the array', () => {
    const id = extractIdentity(decision)
    expect(id.documentType).toBe('national_id')
    expect(id.documentNumber).toBe('12345678')
    expect(id.dateOfBirth).toBe('1995-06-15')
    expect(id.country).toBe('KE')
    expect(id.expiry).toBe('2030-01-01')
    expect(id.fullName).toBe('Amina Wanjiru')
  })

  it('converts the alpha-3 issuing state Didit actually sends', () => {
    // Didit returns alpha-3. The first cut here dropped anything that was not
    // two characters, which looked safe and meant country_of_issue would have
    // been NULL on every single verified row.
    expect(extractIdentity({ id_verifications: [{ issuing_state: 'KEN' }] }).country).toBe('KE')
    // And not by truncation: these three would all be wrong that way.
    expect(extractIdentity({ id_verifications: [{ issuing_state: 'DEU' }] }).country).toBe('DE')
    expect(extractIdentity({ id_verifications: [{ issuing_state: 'CHE' }] }).country).toBe('CH')
    expect(extractIdentity({ id_verifications: [{ issuing_state: 'ZAF' }] }).country).toBe('ZA')
  })

  it('returns null for a code that is not ISO 3166-1 at all', () => {
    expect(extractIdentity({ id_verifications: [{ issuing_state: 'XXX' }] }).country).toBeNull()
  })

  it('returns nulls, not undefined, when the workflow did not run the feature', () => {
    const id = extractIdentity({ status: 'Declined', id_verifications: null })
    expect(id.documentNumber).toBeNull()
    expect(id.documentType).toBeNull()
    expect(id.fullName).toBeNull()
  })

  it('normalises an unmapped document type instead of dropping it', () => {
    expect(extractIdentity({ id_verifications: [{ document_type: 'Voter Card' }] }).documentType)
      .toBe('voter_card')
  })
})

describe('declineReason', () => {
  it('names the check that actually failed', () => {
    const r = declineReason({
      id_verifications: [{ status: 'Approved' }],
      face_matches: [{ status: 'Declined' }],
    })
    expect(r).toContain('did not match')
    expect(r).not.toContain('document could not be verified')
  })

  it('falls back to something a person can act on when nothing is marked', () => {
    expect(declineReason({ status: 'Declined' })).toContain('try again')
  })
})

describe('iso country codes', () => {
  it('converts in both directions for the markets we serve', () => {
    for (const [a2, a3] of [['KE', 'KEN'], ['UG', 'UGA'], ['TZ', 'TZA'], ['RW', 'RWA'], ['ZM', 'ZMB'], ['ET', 'ETH'], ['BI', 'BDI']]) {
      expect(alpha3(a2)).toBe(a3)
      expect(alpha2(a3)).toBe(a2)
    }
  })

  it('does not convert by truncation', () => {
    // The three that catch a truncating implementation.
    expect(alpha2('DEU')).toBe('DE')
    expect(alpha2('CHE')).toBe('CH')
    expect(alpha2('ARE')).toBe('AE')
    expect(alpha3('DE')).toBe('DEU')
  })

  it('accepts alpha-2 on the alpha-2 side so callers need not know the form', () => {
    expect(alpha2('ke')).toBe('KE')
    expect(alpha2(' KEN ')).toBe('KE')
  })

  it('returns null rather than inventing a country', () => {
    expect(alpha3('')).toBeNull()
    expect(alpha3(null)).toBeNull()
    expect(alpha2('ZZ')).toBeNull()
    expect(alpha2('ZZZ')).toBeNull()
  })
})
