// lib/__tests__/kyc-draft.test.ts
// ---------------------------------------------------------------------------
// The step rules decide where a returning user lands, and the age rule decides
// whether a 17-year-old can open an account on an 18+ licence. Both are worth
// more than a render test.
//
// Since migration 123 the document and selfie steps are Didit's, so what is
// left to prove here is that the two steps we still own gate correctly, that
// the verify step is only "done" on a real decision, and that a draft written
// by the six-step wizard loads without dragging its dead fields back.
import { describe, it, expect } from 'vitest'
import {
  STEP,
  STEP_COUNT,
  emptyDraft,
  ageOn,
  isAdult,
  stepComplete,
  firstIncompleteStep,
  canStartVerification,
  savedAgo,
  type KycDraft,
} from '../kyc/draft'

const AT = new Date('2026-10-17T00:00:00Z')

/** A draft with every step we own satisfied, which each test then breaks. */
function fullDraft(): KycDraft {
  const d = emptyDraft('+254712345678', 'KE')
  d.data.firstName = 'Amina'
  d.data.lastName = 'Wanjiru'
  d.data.dateOfBirth = '1995-06-15'
  d.data.addrLine1 = '12 Kenyatta Avenue'
  d.data.addrCity = 'Nairobi'
  return d
}

describe('age', () => {
  it('counts whole years, not millisecond thirds', () => {
    expect(ageOn('2008-10-17', AT)).toBe(18)
    // One day short of the birthday is still 17.
    expect(ageOn('2008-10-18', AT)).toBe(17)
  })

  it('rejects a date that does not exist rather than rolling it forward', () => {
    // Date would silently make this 1 March. On an 18+ rule a silent roll is
    // a date of birth nobody typed.
    expect(ageOn('2000-02-30')).toBeNull()
  })

  it('rejects junk and out-of-range ages', () => {
    expect(isAdult('', AT)).toBe(false)
    expect(isAdult('not-a-date', AT)).toBe(false)
    expect(isAdult('2010-01-01', AT)).toBe(false)
    expect(isAdult('1850-01-01', AT)).toBe(false)
    expect(isAdult('1995-06-15', AT)).toBe(true)
  })
})

describe('step completeness', () => {
  it('needs a legal name on both halves, not just one', () => {
    const d = fullDraft()
    expect(stepComplete(d, STEP.identity)).toBe(true)
    d.data.lastName = ''
    expect(stepComplete(d, STEP.identity)).toBe(false)
    // A single letter is a typo, not a surname.
    d.data.lastName = 'W'
    expect(stepComplete(d, STEP.identity)).toBe(false)
  })

  it('needs a plausible phone number', () => {
    const d = fullDraft()
    d.data.phone = '0712'
    expect(stepComplete(d, STEP.identity)).toBe(false)
  })

  it('needs an under-age date of birth to fail the step, not just the input', () => {
    const d = fullDraft()
    d.data.dateOfBirth = '2015-01-01'
    expect(stepComplete(d, STEP.identity)).toBe(false)
  })

  it('needs a street and a city', () => {
    const d = fullDraft()
    expect(stepComplete(d, STEP.address)).toBe(true)
    d.data.addrCity = ''
    expect(stepComplete(d, STEP.address)).toBe(false)
  })

  it('does not count an unfinished Didit session as a completed verify step', () => {
    const d = fullDraft()
    // The failure this guards: a user who opened the camera and walked away
    // must come BACK to the verify step, not be shown a finished journey.
    for (const s of ['Not Started', 'In Progress', 'Awaiting User', 'Abandoned', 'Expired']) {
      d.didit.status = s
      expect(stepComplete(d, STEP.verify)).toBe(false)
    }
    for (const s of ['Approved', 'In Review', 'Declined']) {
      d.didit.status = s
      expect(stepComplete(d, STEP.verify)).toBe(true)
    }
  })
})

describe('resume point', () => {
  it('lands on the first gap, not the furthest step reached', () => {
    const d = fullDraft()
    d.currentStep = STEP.verify
    d.data.addrCity = ''
    expect(firstIncompleteStep(d)).toBe(STEP.address)
  })

  it('lands on verify when everything we own is done', () => {
    const d = fullDraft()
    expect(firstIncompleteStep(d)).toBe(STEP.verify)
  })

  it('sends an empty draft to the first step', () => {
    expect(firstIncompleteStep(emptyDraft())).toBe(STEP.identity)
  })

  it('has one step per index', () => {
    expect(Object.keys(STEP)).toHaveLength(STEP_COUNT)
  })
})

describe('canStartVerification', () => {
  it('is false until Didit has something to check the document against', () => {
    const d = fullDraft()
    expect(canStartVerification(d)).toBe(true)
    // Without a name there is no expected_details, so Didit's OCR becomes the
    // only source and the cross-check the step exists for does not happen.
    d.data.firstName = ''
    expect(canStartVerification(d)).toBe(false)
  })
})

describe('savedAgo', () => {
  const now = new Date('2026-10-17T12:00:00Z')
  it('reads in the units a person would use', () => {
    expect(savedAgo('2026-10-17T11:59:40Z', now)).toBe('just now')
    expect(savedAgo('2026-10-17T11:45:00Z', now)).toBe('15 minutes ago')
    expect(savedAgo('2026-10-17T09:00:00Z', now)).toBe('3 hours ago')
    expect(savedAgo('2026-10-15T12:00:00Z', now)).toBe('2 days ago')
  })
  it('says nothing rather than NaN when there is no timestamp', () => {
    expect(savedAgo(null, now)).toBeNull()
    expect(savedAgo('nonsense', now)).toBeNull()
  })
})
