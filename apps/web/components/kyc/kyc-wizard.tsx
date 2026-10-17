'use client'

// components/kyc/kyc-wizard.tsx
// Stepped identity verification rebuilt as an institutional "Verification Console":
//   Overview -> Email -> About you -> ID document -> Selfie -> Address -> Review.
// A persistent trust bridge (level meter + vertical step rail + assurance rail)
// sits beside a single-focus gate. Pre-informs requirements up front, shows a live
// verification-level (Basic -> Enhanced), friendly micro-copy throughout, and
// persists to kyc_documents + profile. Pure Pip system, custom icons, no emoji.
//
// SAVE AND RESUME (migration 121)
// Every answer used to live in React state and reach the database in one write
// at the very end, so a refresh, a flat battery, or moving from the phone that
// has the camera to the laptop that has the address meant starting over at
// step one. Document upload is the step people abandon, and we were asking
// them to repeat the four steps before it.
//
// Now each step is written to `kyc_drafts` as it is left, documents upload as
// they are chosen rather than at submit, and a returning user lands on the
// first step they have NOT finished. Shape borrowed from Lemonway's
// save-and-resume onboarding (server-side draft, resume path, expiry) and
// Upwardli's rule that finished steps are never asked again. The draft lives
// on the server, not in localStorage, because changing device is the case that
// actually breaks people.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { User } from '@supabase/supabase-js'
import { getBrowserClient } from '@/lib/supabase/client-lazy'
import { KycConsole } from '@/components/kyc/kyc-console'
import { KycStepper, type StepDef } from '@/components/kyc/kyc-stepper'
import { VerificationMeter } from '@/components/kyc/verification-meter'
import { FileDrop } from '@/components/kyc/file-drop'
import { LevelBadge, type KycLevel } from '@/components/kyc/level-badge'
import {
  STEP,
  loadDraft,
  saveDraft,
  clearDraft,
  stepComplete,
  firstIncompleteStep,
  canSubmit,
  savedAgo,
  isAdult,
  MIN_AGE,
  type KycDraft,
  type DocType as DraftDocType,
} from '@/lib/kyc/draft'
import {
  IconMail,
  IconPhone,
  IconKYC,
  IconUser,
  IconHome,
  IconShield,
  IconCheck,
  IconArrowRight,
  IconChevronLeft,
  IconClock,
} from '@/components/ui/icons'

type DocType = 'national_id' | 'passport' | 'drivers_license'

const COUNTRIES = [
  { code: 'KE', name: 'Kenya' },
  { code: 'UG', name: 'Uganda' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'RW', name: 'Rwanda' },
  { code: 'ZM', name: 'Zambia' },
  { code: 'ET', name: 'Ethiopia' },
  { code: 'BI', name: 'Burundi' },
]

const DOC_TYPES: { value: DocType; label: string; needsBack: boolean }[] = [
  { value: 'national_id', label: 'National ID', needsBack: true },
  { value: 'passport', label: 'Passport', needsBack: false },
  { value: 'drivers_license', label: "Driver's licence", needsBack: true },
]

const STEPS: StepDef[] = [
  { key: 'email', label: 'Email', icon: <IconMail size={15} />, desc: 'Confirm your account email' },
  { key: 'identity', label: 'About you', icon: <IconPhone size={15} />, desc: 'Phone and date of birth' },
  { key: 'id', label: 'ID document', icon: <IconKYC size={15} />, desc: 'A government-issued ID' },
  { key: 'selfie', label: 'Selfie', icon: <IconUser size={15} />, desc: 'Match your face to your ID' },
  { key: 'address', label: 'Address', icon: <IconHome size={15} />, desc: 'Unlocks Enhanced access' },
  { key: 'review', label: 'Review', icon: <IconCheck size={15} />, desc: 'Check and submit' },
]

interface KycWizardProps {
  user: User
  initialPhone: string
  initialCountry: string
  /** Where to send the user after submitting, to resume what they were doing (#15). */
  returnTo?: string
}

export function KycWizard({ user, initialPhone, initialCountry, returnTo = '/portfolio' }: KycWizardProps) {
  // Loaded on first use, not during render: this wizard's every call sits
  // inside the submit path, and a visitor who opens the page to read what is
  // required should not pay ~66 kB for it. Ruling A11.

  const [started, setStarted] = useState(false)
  const [step, setStep] = useState(0)

  // Field state
  const [phone, setPhone] = useState(initialPhone)
  const [docType, setDocType] = useState<DocType>('national_id')
  const [docNumber, setDocNumber] = useState('')
  const [idCountry, setIdCountry] = useState(initialCountry || 'KE')
  const [expiry, setExpiry] = useState('')
  const [frontFile, setFrontFile] = useState<File | null>(null)
  const [backFile, setBackFile] = useState<File | null>(null)
  const [selfieFile, setSelfieFile] = useState<File | null>(null)
  const [addrLine1, setAddrLine1] = useState('')
  const [addrCity, setAddrCity] = useState('')
  const [addrPostal, setAddrPostal] = useState('')
  const [addrCountry, setAddrCountry] = useState(initialCountry || 'KE')

  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  // ---- RESUMABLE STATE (migration 121) ----------------------------------
  // Date of birth: the one field an 18+ licence actually turns on, and the one
  // the wizard never collected.
  const [dob, setDob] = useState('')
  // Uploaded document PATHS. A resumed journey has these and no File objects,
  // which is exactly why completeness is judged on the path and not the File.
  const [frontPath, setFrontPath] = useState<string | null>(null)
  const [backPath, setBackPath] = useState<string | null>(null)
  const [selfiePath, setSelfiePath] = useState<string | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  // Draft lifecycle.
  const [hydrated, setHydrated] = useState(false)
  const [resumedAt, setResumedAt] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const needsBack = DOC_TYPES.find((d) => d.value === docType)?.needsBack ?? false

  /** The draft as the pure step rules want it (lib/kyc/draft.ts). */
  const draft = useMemo<KycDraft>(
    () => ({
      currentStep: step,
      data: {
        phone,
        dateOfBirth: dob,
        docType: docType as DraftDocType,
        docNumber,
        idCountry,
        expiry,
        addrLine1,
        addrCity,
        addrPostal,
        addrCountry,
      },
      frontPath,
      backPath,
      selfiePath,
      updatedAt: resumedAt,
    }),
    [step, phone, dob, docType, docNumber, idCountry, expiry, addrLine1, addrCity, addrPostal,
     addrCountry, frontPath, backPath, selfiePath, resumedAt],
  )

  // Per-step completeness (also drives the level meter). One source of truth,
  // shared with the tests, so "may I continue" and "where do I resume" can
  // never disagree.
  const identityOk = stepComplete(draft, STEP.identity)
  const idOk = stepComplete(draft, STEP.document)
  const selfieOk = stepComplete(draft, STEP.selfie)
  const addressOk = stepComplete(draft, STEP.address)
  const level: KycLevel = identityOk && idOk && selfieOk && addressOk ? 'enhanced' : 'basic'

  const canContinue = stepComplete(draft, step)
  const isLast = step === STEPS.length - 1

  // ---- Load any saved draft, once -----------------------------------------
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = await getBrowserClient()
      const saved = await loadDraft(supabase, user.id, initialPhone, initialCountry)
      if (cancelled) return
      if (saved) {
        setPhone(saved.data.phone)
        setDob(saved.data.dateOfBirth)
        setDocType(saved.data.docType as DocType)
        setDocNumber(saved.data.docNumber)
        setIdCountry(saved.data.idCountry)
        setExpiry(saved.data.expiry)
        setAddrLine1(saved.data.addrLine1)
        setAddrCity(saved.data.addrCity)
        setAddrPostal(saved.data.addrPostal)
        setAddrCountry(saved.data.addrCountry)
        setFrontPath(saved.frontPath)
        setBackPath(saved.backPath)
        setSelfiePath(saved.selfiePath)
        // Land on the first GAP, not on the furthest step reached: someone who
        // skipped past the selfie must come back to it.
        setStep(firstIncompleteStep(saved))
        setResumedAt(saved.updatedAt)
        setStarted(true)
      }
      setHydrated(true)
    })()
    return () => {
      cancelled = true
    }
  }, [user.id, initialPhone, initialCountry])

  /** Write the draft. Called when a step is left, not on every keystroke. */
  const persist = async (next: number) => {
    setSaving(true)
    const supabase = await getBrowserClient()
    await saveDraft(supabase, user.id, { ...draft, currentStep: next })
    setSaving(false)
  }

  /**
   * Upload one document as its step is completed, rather than holding every
   * file in memory until submit. This is what makes resuming worth anything:
   * the photo taken on a phone is already in storage when the journey
   * continues on a laptop.
   */
  const putFile = async (
    file: File,
    kind: 'front' | 'back' | 'selfie',
    setPath: (p: string | null) => void,
  ) => {
    setUploading(kind)
    setError('')
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${user.id}/${kind}.${ext}`
    const supabase = await getBrowserClient()
    const { error: upErr } = await supabase.storage
      .from('kyc-documents')
      .upload(path, file, { upsert: true })
    setUploading(null)
    if (upErr) {
      setError('That upload did not go through. Check your connection and try again.')
      setPath(null)
      return
    }
    setPath(path)

    // SAVE THE PATH NOW, not when the step is left.
    //
    // Everything else can wait for the Continue button, because retyping a
    // phone number is cheap. A document is not: it is the slow step, often on
    // a phone camera and a mobile connection, and it is where people stop. The
    // first cut only wrote the draft on navigation, so uploading and then
    // closing the tab left the file sitting in storage with the draft unaware
    // of it, and the next visit asked for the photo again. Caught by driving
    // the real wizard and reading the row back: the object existed,
    // front_path was NULL.
    //
    // The patch is passed explicitly rather than read from `draft`, which is
    // memoised from state that has not re-rendered yet at this point.
    const patch = {
      front: { frontPath: path },
      back: { backPath: path },
      selfie: { selfiePath: path },
    }[kind]
    await saveDraft(supabase, user.id, { ...draft, ...patch })
  }


  const handleSubmit = async () => {
    setError('')
    setSubmitting(true)
    const supabase = await getBrowserClient()

    // The documents are already in storage: each uploaded as its step was
    // completed, which is what makes a resumed journey skip them. Submit only
    // turns the stored paths into the URLs review reads.
    if (!frontPath || !selfiePath) {
      setError('Your ID photo or selfie is missing. Go back a step and add it.')
      setSubmitting(false)
      return
    }
    const publicUrl = (p: string) =>
      supabase.storage.from('kyc-documents').getPublicUrl(p).data.publicUrl
    const frontUrl = publicUrl(frontPath)
    const backUrl = backPath ? publicUrl(backPath) : null
    const selfieUrl = publicUrl(selfiePath)

    // Belt and braces against the 18+ rule: the DB has a CHECK, the step gate
    // has isAdult(), and a submission cannot slip between them.
    if (!isAdult(dob)) {
      setError(`You must be ${MIN_AGE} or older to verify an account.`)
      setSubmitting(false)
      return
    }

    // Persist the identity packet (existing columns — always valid).
    // `date_of_birth` is added by migration 121 and is not yet in the
    // generated types (apps/web/types/supabase.ts), the same situation the
    // address columns from migration 019 are in a few lines below. Regenerate
    // with `npm run db:types` from somewhere that can reach Postgres on 5432
    // and this cast can go.
    const insertPayload = {
      user_id: user.id,
      document_type: docType,
      document_number: docNumber || null,
      date_of_birth: dob || null,
      country_of_issue: idCountry,
      expiry_date: expiry || null,
      front_image_url: frontUrl,
      back_image_url: backUrl,
      selfie_image_url: selfieUrl,
      status: 'pending' as const,
    }

    const { data: doc, error: dbErr } = await supabase
      .from('kyc_documents')
      .insert(insertPayload as never)
      .select('id')
      .single()

    if (dbErr || !doc) {
      setError(dbErr?.message ?? 'Could not save your submission. Please try again.')
      setSubmitting(false)
      return
    }

    // Best-effort address (Enhanced tier). Non-fatal if the migration that adds
    // these columns hasn't been applied yet — the submission still succeeds.
    try {
      const addressPatch = {
        address_line1: addrLine1 || null,
        address_city: addrCity || null,
        address_postal_code: addrPostal || null,
        address_country: addrCountry || null,
      }
      // Cast: these columns are added by migration 019 and may not be in the
      // generated Supabase types yet. Non-fatal if absent.
      await supabase
        .from('kyc_documents')
        .update(addressPatch as never)
        .eq('id', doc.id)
    } catch {
      /* columns not present yet — ignore */
    }

    // Save phone + flip profile to pending.
    await supabase
      .from('profiles')
      .update({ phone_number: phone.trim(), kyc_status: 'pending' })
      .eq('id', user.id)

    // The submission is now the record. A draft that outlived it would offer
    // to "resume" a journey that is already with a reviewer.
    await clearDraft(supabase, user.id)

    setSubmitting(false)
    setSubmitted(true)
  }

  // The bridge (desktop): live level meter + the vertical step rail.
  const bridge = (
    <div className="space-y-9">
      <VerificationMeter level={level} pending={submitted} />
      <div>
        <span className="mb-4 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          {started ? 'Your progress' : `${STEPS.length} quick steps`}
        </span>
        <KycStepper steps={STEPS} current={submitted ? STEPS.length : started ? step : -1} variant="vertical" />
      </div>
    </div>
  )

  // ---- Submitted -----------------------------------------------------------
  if (submitted) {
    return (
      <KycConsole bridge={bridge}>
        <div className="card animate-scale-in p-8 text-center sm:p-10">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-pill bg-yes/10 text-yes-700">
            <IconCheck size={30} strokeWidth={2.5} />
          </div>
          <div className="mb-3 flex justify-center">
            <LevelBadge level="enhanced" pending />
          </div>
          <h2 className="font-display text-2xl text-text-primary">Submitted for review</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-secondary">
            Thanks — our compliance team will review your documents, usually within 1–2 business
            days. We&apos;ll email you the moment you&apos;re verified.
          </p>
          <div className="mx-auto mt-6 flex max-w-xs items-center justify-center gap-1.5 rounded-md border border-hairline bg-surface-2 px-3 py-2 text-xs text-text-muted">
            <IconShield size={13} className="text-pip-500" /> Your documents are encrypted and
            private.
          </div>
          {/* Resume where they were, not a dead confirmation (#15). */}
          <Link href={returnTo} className="btn btn-primary mt-6">
            Continue
          </Link>
        </div>
      </KycConsole>
    )
  }

  // ---- Pre-inform / overview ----------------------------------------------
  if (!started) {
    return (
      <KycConsole bridge={bridge}>
        <div className="animate-fade-in">
          <span className="inline-flex items-center gap-1.5 rounded-pill bg-pip-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-pip-500">
            <IconShield size={12} /> Identity verification
          </span>
          <h1 className="mt-4 font-display text-3xl leading-tight text-text-primary">
            Verify your identity
          </h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-text-secondary">
            A quick, one-time check that keeps Elopis safe and unlocks higher deposit and
            withdrawal limits. Most people finish in about{' '}
            <span className="inline-flex items-center gap-1 font-semibold text-text-primary">
              <IconClock size={13} /> 3 minutes
            </span>
            .
          </p>

          <div className="mt-7 card p-5 sm:p-6">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              What you&apos;ll need
            </h2>
            <ul className="mt-4 space-y-4">
              {[
                { icon: <IconPhone size={16} />, t: 'Your phone number', s: 'For account security and payouts' },
                { icon: <IconKYC size={16} />, t: 'A government ID', s: 'National ID, passport or driver’s licence' },
                { icon: <IconUser size={16} />, t: 'A selfie', s: 'To match you to your document' },
                { icon: <IconHome size={16} />, t: 'Your residential address', s: 'Required for Enhanced access' },
              ].map((r) => (
                <li key={r.t} className="flex items-start gap-3">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-pip-100 text-pip-500">
                    {r.icon}
                  </span>
                  <span className="pt-0.5">
                    <span className="block text-sm font-semibold text-text-primary">{r.t}</span>
                    <span className="block text-xs text-text-muted">{r.s}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4 flex items-start gap-2.5 rounded-md border border-hairline bg-surface-2 p-3.5 text-xs leading-relaxed text-text-muted">
            <IconShield size={15} className="mt-0.5 flex-none text-pip-500" />
            <span>
              Bank-grade encryption. Your documents are private, used only for verification, and
              never sold or shared — reviewed by our compliance team.
            </span>
          </div>

          <button
            type="button"
            onClick={() => setStarted(true)}
            className="btn btn-primary btn-lg mt-6 w-full sm:w-auto"
          >
            Start verification <IconArrowRight size={16} />
          </button>

          {/* Mobile-only trust chips (bridge is hidden on small screens) */}
          <p className="mt-5 flex items-center gap-1.5 text-xs text-text-muted lg:hidden">
            <IconShield size={12} /> AES-256 encryption · Never sold or shared · Human review
          </p>
        </div>
      </KycConsole>
    )
  }

  // ---- Stepped flow --------------------------------------------------------
  return (
    <KycConsole bridge={bridge}>
      <div className="animate-fade-in">
        {/* Mobile progress + level (bridge hidden < lg) */}
        <div className="mb-6 lg:hidden">
          <div className="mb-3 flex items-center justify-between">
            <h1 className="font-display text-lg text-text-primary">Verify your identity</h1>
            <LevelBadge level={level} />
          </div>
          <KycStepper steps={STEPS} current={step} variant="compact" />
        </div>

        <div className="card p-5 sm:p-7">
          {!hydrated && (
            <p className="mb-4 text-xs text-text-muted" aria-live="polite">
              Checking for saved progress…
            </p>
          )}
          {/* RESUME NOTICE. Shown once, when a saved journey was picked up, so
              the reason the wizard opened in the middle is stated rather than
              left to be inferred. */}
          {resumedAt && (
            <div className="mb-4 flex items-start gap-2.5 rounded-md border border-hairline bg-surface-2 p-3">
              <IconClock size={14} className="mt-0.5 flex-none text-text-muted" />
              <p className="text-xs text-text-secondary">
                Picked up where you left off
                {savedAgo(resumedAt) ? ` — saved ${savedAgo(resumedAt)}` : ''}. Your finished
                steps are kept, so you do not have to upload anything twice.
              </p>
            </div>
          )}

          {/* Step eyebrow */}
          <div className="mb-4 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wide text-text-muted">
              Step {step + 1} of {STEPS.length}
              {saving ? ' · saving' : uploading ? ' · uploading' : ''}
            </span>
            <span className="hidden lg:block">
              <LevelBadge level={level} />
            </span>
          </div>

          {step === 0 && (
            <StepBody
              title="Confirm your email"
              copy="This is the email linked to your account. We'll send verification updates here."
            >
              <label htmlFor="kyc-email" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
                Email
              </label>
              <div className="flex items-center gap-2">
                <input id="kyc-email" className="input w-full" value={user.email ?? ''} readOnly />
                <span className="badge badge-green flex-none gap-1">
                  <IconCheck size={11} strokeWidth={2.5} /> Verified
                </span>
              </div>
            </StepBody>
          )}

          {step === 1 && (
            <StepBody title="Your phone number" copy="Used for account security and to process payouts.">
              <label htmlFor="kyc-phone" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
                Phone number
              </label>
              <input
                id="kyc-phone"
                className="input w-full"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+254 7XX XXX XXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              {phone.length > 0 && !/^[+]?[\d\s-]{7,}$/.test(phone.trim()) && (
                <p className="mt-1.5 text-xs text-text-muted">Enter a valid phone number, including country code.</p>
              )}

              {/* DATE OF BIRTH. The product had no DOB field anywhere, on a
                  platform that may only serve adults. The rule turns on this
                  one value, so it is collected here and checked in three
                  places: this input, the step gate, and a CHECK constraint. */}
              <label
                htmlFor="kyc-dob"
                className="mb-1.5 mt-5 block text-xs font-semibold uppercase tracking-wide text-text-muted"
              >
                Date of birth
              </label>
              <input
                id="kyc-dob"
                className="input w-full"
                type="date"
                autoComplete="bday"
                max={new Date(Date.now() - MIN_AGE * 31557600000).toISOString().slice(0, 10)}
                value={dob}
                onChange={(e) => setDob(e.target.value)}
              />
              <p className="mt-1.5 text-xs text-text-muted">
                {dob.length > 0 && !isAdult(dob)
                  ? `You must be ${MIN_AGE} or older to use Elopis.`
                  : `Elopis is for over-${MIN_AGE}s. This must match your ID.`}
              </p>
            </StepBody>
          )}

          {step === 2 && (
            <StepBody title="Government ID" copy="Choose a document, then upload clear photos — all corners visible, no glare.">
              <div className="space-y-4">
                <div>
                  <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">Document type</span>
                  <div className="grid grid-cols-3 gap-2">
                    {DOC_TYPES.map((d) => (
                      <button
                        key={d.value}
                        type="button"
                        onClick={() => setDocType(d.value)}
                        aria-pressed={docType === d.value}
                        className={`rounded-sm border px-2 py-2.5 text-xs font-semibold transition-colors ${
                          docType === d.value
                            ? 'border-pip-400 bg-pip-100 text-pip-500'
                            : 'border-hairline bg-surface-2 text-text-secondary hover:border-pip-300'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="doc-number" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
                      Document number
                    </label>
                    <input
                      id="doc-number"
                      className="input w-full"
                      value={docNumber}
                      onChange={(e) => setDocNumber(e.target.value)}
                      placeholder="e.g. 12345678"
                    />
                  </div>
                  <div>
                    <label htmlFor="doc-country" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
                      Country of issue
                    </label>
                    <select id="doc-country" className="input w-full" value={idCountry} onChange={(e) => setIdCountry(e.target.value)}>
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="doc-expiry" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Expiry date <span className="font-normal normal-case text-text-muted">(optional)</span>
                  </label>
                  <input id="doc-expiry" className="input w-full" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
                </div>

                <FileDrop
                  label="Front of document"
                  uploaded={!!frontPath}
                  file={frontFile}
                  onChange={(f) => {
                    setFrontFile(f)
                    if (f) void putFile(f, 'front', setFrontPath)
                    else setFrontPath(null)
                  }}
                  capture="environment"
                />
                {needsBack && (
                  <FileDrop
                    label="Back of document"
                    uploaded={!!backPath}
                    file={backFile}
                    onChange={(f) => {
                      setBackFile(f)
                      if (f) void putFile(f, 'back', setBackPath)
                      else setBackPath(null)
                    }}
                    capture="environment"
                  />
                )}
              </div>
            </StepBody>
          )}

          {step === 3 && (
            <StepBody title="Take a selfie" copy="Face the camera in good light, no hat or sunglasses. We use it only to match you to your ID.">
              <FileDrop
                label="Selfie"
                hint="Front camera"
                uploaded={!!selfiePath}
                file={selfieFile}
                onChange={(f) => {
                  setSelfieFile(f)
                  if (f) void putFile(f, 'selfie', setSelfiePath)
                  else setSelfiePath(null)
                }}
                capture="user"
              />
            </StepBody>
          )}

          {step === 4 && (
            <StepBody title="Residential address" copy="Your current home address. Required to reach the Enhanced verification level.">
              <div className="space-y-3">
                <div>
                  <label htmlFor="addr1" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Street address
                  </label>
                  <input id="addr1" className="input w-full" autoComplete="address-line1" value={addrLine1} onChange={(e) => setAddrLine1(e.target.value)} placeholder="123 Ngong Road" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="addr-city" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">City</label>
                    <input id="addr-city" className="input w-full" autoComplete="address-level2" value={addrCity} onChange={(e) => setAddrCity(e.target.value)} placeholder="Nairobi" />
                  </div>
                  <div>
                    <label htmlFor="addr-postal" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
                      Postal code <span className="font-normal normal-case">(optional)</span>
                    </label>
                    <input id="addr-postal" className="input w-full" autoComplete="postal-code" value={addrPostal} onChange={(e) => setAddrPostal(e.target.value)} placeholder="00100" />
                  </div>
                </div>
                <div>
                  <label htmlFor="addr-country" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">Country</label>
                  <select id="addr-country" className="input w-full" value={addrCountry} onChange={(e) => setAddrCountry(e.target.value)}>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </StepBody>
          )}

          {/* REVIEW. A last readable pass before anything is sent to a human
              reviewer, and the only screen that shows the whole packet at
              once. Each row jumps back to the step that owns it, so a
              correction costs one click rather than a walk through the
              wizard. */}
          {step === STEP.review && (
            <StepBody title="Check your details" copy="Make sure these match your document exactly. You can change anything before you submit.">
              <dl className="divide-y divide-hairline">
                {(
                  [
                    ['Phone', phone, STEP.identity],
                    ['Date of birth', dob, STEP.identity],
                    ['Document', DOC_TYPES.find((d) => d.value === docType)?.label ?? docType, STEP.document],
                    ['Document number', docNumber, STEP.document],
                    ['ID photos', frontPath ? (backPath ? 'Front and back uploaded' : 'Front uploaded') : 'Missing', STEP.document],
                    ['Selfie', selfiePath ? 'Uploaded' : 'Missing', STEP.selfie],
                    ['Address', [addrLine1, addrCity, addrPostal].filter(Boolean).join(', '), STEP.address],
                  ] as const
                ).map(([label, value, target]) => (
                  <div key={label} className="flex items-baseline justify-between gap-4 py-2.5">
                    <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</dt>
                    <dd className="flex min-w-0 items-baseline gap-3 text-right">
                      <span className="truncate text-sm text-text-primary">{value || '—'}</span>
                      <button
                        type="button"
                        onClick={() => {
                          setStep(target)
                          void persist(target)
                        }}
                        className="flex-none text-xs font-semibold text-pip-text hover:underline"
                      >
                        Edit
                      </button>
                    </dd>
                  </div>
                ))}
              </dl>
            </StepBody>
          )}

          {error && (
            <div role="alert" aria-live="assertive" className="mt-4 rounded-md border border-no/30 bg-no/10 p-3 text-xs text-no">
              {error}
            </div>
          )}

          {/* Nav */}
          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                if (step === 0) return setStarted(false)
                const prev = step - 1
                setStep(prev)
                void persist(prev)
              }}
              className="btn btn-ghost btn-sm gap-1"
              disabled={submitting}
            >
              <IconChevronLeft size={15} /> Back
            </button>

            {isLast ? (
              <button type="button" onClick={handleSubmit} className="btn btn-primary" disabled={submitting || !canSubmit(draft) || uploading !== null}>
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 11-6.219-8.56" />
                    </svg>
                    Submitting…
                  </span>
                ) : (
                  <>Submit for review <IconArrowRight size={15} /></>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  const next = step + 1
                  setStep(next)
                  // Written as the step is LEFT, not on every keystroke: one
                  // row per decision, not one per character.
                  void persist(next)
                }}
                className="btn btn-primary"
                disabled={!canContinue || uploading !== null}
              >
                Continue <IconArrowRight size={15} />
              </button>
            )}
          </div>
        </div>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-text-muted">
          <IconShield size={12} /> Encrypted end-to-end · Reviewed by our compliance team
        </p>
      </div>
    </KycConsole>
  )
}

function StepBody({ title, copy, children }: { title: string; copy: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="font-display text-xl text-text-primary">{title}</h2>
      <p className="mb-5 mt-1 text-sm leading-relaxed text-text-secondary">{copy}</p>
      {children}
    </div>
  )
}
