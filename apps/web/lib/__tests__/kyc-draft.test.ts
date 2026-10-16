// lib/__tests__/kyc-draft.test.ts
// ---------------------------------------------------------------------------
// The step rules decide whether a returning user is asked for their ID photo a
// second time, and the age rule decides whether a 17-year-old can open an
// account on an 18+ licence. Both are worth more than a render test.
import { describe, it, expect } from 'vitest'
import {
  STEP,
  STEP_COUNT,
  emptyDraft,
  needsBack,
  ageOn,
  isAdult,
  stepComplete,
  firstIncompleteStep,
  canSubmit,
  savedAgo,
  type KycDraft,
} from '../kyc/draft'

const AT = new Date('2026-10-17T00:00:00Z')

/** A draft with every step satisfied, which each test then breaks one way. */
function fullDraft(): KycDraft {
  const d = emptyDraft('+254712345678', 'KE')
  d.data.dateOfBirth = '1995-06-15'
  d.data.docNumber = '12345678'
  d.data.addrLine1 = '12 Kenyatta Avenue'
  d.data.addrCity = 'Nairobi'
  d.frontPath = 'u/front.jpg'
  d.backPath = 'u/back.jpg'
  d.selfiePath = 'u/selfie.jpg'
  return d
}

describe('age', () => {
  it('counts whole years, not millisecond thirds', () => {
    expect(ageOn('2008-10-17', AT)).toBe(18)
    // One day short of the birthday is still 17.
    expect(ageOn('2008-10-18', AT)).toBe(17)
  })

  it('does not round a 29 February birthday the wrong way', () => {
    // The naive (now - dob) / 365.25d version drifts across leap years; this
    // person turns 18 on 2026-02-28/29, so by October they are 18.
    expect(ageOn('2008-02-29', AT)).toBe(18)
  })

  it('rejects dates that are not dates', () => {
    // Date() would silently roll 2026-02-30 forward to 1 March.
    expect(ageOn('2008-02-30', AT)).toBeNull()
    expect(ageOn('not-a-date', AT)).toBeNull()
    expect(ageOn('', AT)).toBeNull()
  })

  it('admits adults and refuses minors and impossible ages', () => {
    expect(isAdult('2008-10-17', AT)).toBe(true)
    expect(isAdult('2008-10-18', AT)).toBe(false)
    expect(isAdult('1850-01-01', AT)).toBe(false)
  })
})

describe('step completeness', () => {
  it('a complete draft satisfies every step', () => {
    const d = fullDraft()
    for (let s = 0; s < STEP_COUNT; s++) {
      expect(stepComplete(d, s), `step ${s}`).toBe(true)
    }
    expect(canSubmit(d)).toBe(true)
    expect(firstIncompleteStep(d)).toBe(STEP.review)
  })

  it('an underage date of birth blocks the identity step', () => {
    const d = fullDraft()
    d.data.dateOfBirth = '2010-01-01'
    expect(stepComplete(d, STEP.identity)).toBe(false)
    expect(canSubmit(d)).toBe(false)
    expect(firstIncompleteStep(d)).toBe(STEP.identity)
  })

  it('a stored path counts as an upload, with no File in memory', () => {
    // THE POINT OF RESUMING. A user who uploaded yesterday on a phone has no
    // File object today on a laptop; only the path survives, and it must be
    // enough.
    const d = fullDraft()
    expect(stepComplete(d, STEP.document)).toBe(true)
    d.frontPath = null
    expect(stepComplete(d, STEP.document)).toBe(false)
  })

  it('only asks for the reverse side when the document has one', () => {
    const d = fullDraft()
    d.backPath = null
    d.data.docType = 'national_id'
    expect(needsBack('national_id')).toBe(true)
    expect(stepComplete(d, STEP.document)).toBe(false)

    d.data.docType = 'passport'
    expect(needsBack('passport')).toBe(false)
    expect(stepComplete(d, STEP.document)).toBe(true)
  })

  it('resumes at the first gap, not at the furthest step reached', () => {
    // Someone who skipped ahead and left the selfie behind must come back to
    // the selfie, not be dropped at the address they half-typed.
    const d = fullDraft()
    d.selfiePath = null
    d.currentStep = STEP.address
    expect(firstIncompleteStep(d)).toBe(STEP.selfie)
  })

  it('an empty draft starts at the identity step', () => {
    // Step 0 is the account email, which is already known, so a fresh journey
    // has nothing to do there.
    const d = emptyDraft('', 'KE')
    expect(stepComplete(d, STEP.email)).toBe(true)
    expect(firstIncompleteStep(d)).toBe(STEP.identity)
    expect(canSubmit(d)).toBe(false)
  })
})

describe('savedAgo', () => {
  const now = new Date('2026-10-17T12:00:00Z')
  it.each([
    ['2026-10-17T11:59:30Z', 'just now'],
    ['2026-10-17T11:58:00Z', '2 minutes ago'],
    ['2026-10-17T11:00:00Z', '1 hour ago'],
    ['2026-10-15T12:00:00Z', '2 days ago'],
  ])('%s -> %s', (at, expected) => {
    expect(savedAgo(at, now)).toBe(expected)
  })

  it('says nothing when there is nothing to say', () => {
    expect(savedAgo(null, now)).toBeNull()
    expect(savedAgo('nonsense', now)).toBeNull()
  })
})
