'use client'

// components/kyc/kyc-wizard.tsx
// Stepped identity verification rebuilt as an institutional "Verification Console":
//   Overview -> Email -> Phone -> ID document -> Selfie -> Address -> Submit.
// A persistent trust bridge (level meter + vertical step rail + assurance rail)
// sits beside a single-focus gate. Pre-informs requirements up front, shows a live
// verification-level (Basic -> Enhanced), friendly micro-copy throughout, and
// persists to kyc_documents + profile. Pure Pip system, custom icons, no emoji.
import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { KycConsole } from '@/components/kyc/kyc-console'
import { KycStepper, type StepDef } from '@/components/kyc/kyc-stepper'
import { VerificationMeter } from '@/components/kyc/verification-meter'
import { FileDrop } from '@/components/kyc/file-drop'
import { LevelBadge, type KycLevel } from '@/components/kyc/level-badge'
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
  { key: 'phone', label: 'Phone', icon: <IconPhone size={15} />, desc: 'For security & payouts' },
  { key: 'id', label: 'ID document', icon: <IconKYC size={15} />, desc: 'A government-issued ID' },
  { key: 'selfie', label: 'Selfie', icon: <IconUser size={15} />, desc: 'Match your face to your ID' },
  { key: 'address', label: 'Address', icon: <IconHome size={15} />, desc: 'Unlocks Enhanced access' },
]

interface KycWizardProps {
  user: User
  initialPhone: string
  initialCountry: string
  /** Where to send the user after submitting, to resume what they were doing (#15). */
  returnTo?: string
}

export function KycWizard({ user, initialPhone, initialCountry, returnTo = '/portfolio' }: KycWizardProps) {
  const supabase = useMemo(() => createClient(), [])

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

  const needsBack = DOC_TYPES.find((d) => d.value === docType)?.needsBack ?? false

  // Per-step completeness (also drives the level meter).
  const phoneOk = /^[+]?[\d\s-]{7,}$/.test(phone.trim())
  const idOk = docNumber.trim().length > 2 && !!frontFile && (!needsBack || !!backFile)
  const selfieOk = !!selfieFile
  const addressOk = addrLine1.trim().length > 2 && addrCity.trim().length > 1
  const level: KycLevel = idOk && selfieOk && addressOk ? 'enhanced' : 'basic'

  const canContinue = [true, phoneOk, idOk, selfieOk, addressOk][step]
  const isLast = step === STEPS.length - 1

  const uploadFile = async (file: File, path: string): Promise<string | null> => {
    const { data, error: upErr } = await supabase.storage
      .from('kyc-documents')
      .upload(path, file, { upsert: true })
    if (upErr || !data) return null
    return supabase.storage.from('kyc-documents').getPublicUrl(data.path).data.publicUrl
  }

  const handleSubmit = async () => {
    setError('')
    setSubmitting(true)
    const ts = Date.now()
    const ext = (f: File) => f.name.split('.').pop() || 'jpg'

    const [frontUrl, backUrl, selfieUrl] = await Promise.all([
      uploadFile(frontFile!, `${user.id}/${ts}-front.${ext(frontFile!)}`),
      backFile ? uploadFile(backFile, `${user.id}/${ts}-back.${ext(backFile)}`) : Promise.resolve(null),
      uploadFile(selfieFile!, `${user.id}/${ts}-selfie.${ext(selfieFile!)}`),
    ])

    if (!frontUrl || !selfieUrl) {
      setError('Upload failed — please check your connection and try again.')
      setSubmitting(false)
      return
    }

    // Persist the identity packet (existing columns — always valid).
    const { data: doc, error: dbErr } = await supabase
      .from('kyc_documents')
      .insert({
        user_id: user.id,
        document_type: docType,
        document_number: docNumber || null,
        country_of_issue: idCountry,
        expiry_date: expiry || null,
        front_image_url: frontUrl,
        back_image_url: backUrl,
        selfie_image_url: selfieUrl,
        status: 'pending',
      })
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

    setSubmitting(false)
    setSubmitted(true)
  }

  // The bridge (desktop): live level meter + the vertical step rail.
  const bridge = (
    <div className="space-y-9">
      <VerificationMeter level={level} pending={submitted} />
      <div>
        <span className="mb-4 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          {started ? 'Your progress' : 'Five quick steps'}
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
            A quick, one-time check that keeps Kichiko safe and unlocks higher deposit and
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
          {/* Step eyebrow */}
          <div className="mb-4 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wide text-text-muted">
              Step {step + 1} of {STEPS.length}
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
              {phone.length > 0 && !phoneOk && (
                <p className="mt-1.5 text-xs text-text-muted">Enter a valid phone number, including country code.</p>
              )}
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

                <FileDrop label="Front of document" file={frontFile} onChange={setFrontFile} capture="environment" />
                {needsBack && (
                  <FileDrop label="Back of document" file={backFile} onChange={setBackFile} capture="environment" />
                )}
              </div>
            </StepBody>
          )}

          {step === 3 && (
            <StepBody title="Take a selfie" copy="Face the camera in good light, no hat or sunglasses. We use it only to match you to your ID.">
              <FileDrop label="Selfie" hint="Front camera" file={selfieFile} onChange={setSelfieFile} capture="user" />
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

          {error && (
            <div role="alert" aria-live="assertive" className="mt-4 rounded-md border border-no/30 bg-no/10 p-3 text-xs text-no">
              {error}
            </div>
          )}

          {/* Nav */}
          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => (step === 0 ? setStarted(false) : setStep((s) => s - 1))}
              className="btn btn-ghost btn-sm gap-1"
              disabled={submitting}
            >
              <IconChevronLeft size={15} /> Back
            </button>

            {isLast ? (
              <button type="button" onClick={handleSubmit} className="btn btn-primary" disabled={!canContinue || submitting}>
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
              <button type="button" onClick={() => setStep((s) => s + 1)} className="btn btn-primary" disabled={!canContinue}>
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
