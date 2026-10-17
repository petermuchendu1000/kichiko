'use client'

// components/kyc/kyc-wizard.tsx
// Identity verification: About you -> Address -> ID check.
//
// WHAT THIS USED TO BE
// Six steps, three of them collecting evidence by hand: document type and
// number, a photograph of the front, one of the back, a selfie. All of it went
// to a private bucket and then to a person, who looked at a JPEG and decided
// whether it was genuine. A person cannot verify an MRZ checksum, cannot tell
// a printed photo held up to a camera from a face, and cannot check a name
// against a sanctions list. They took one to two days to not do those things.
//
// Didit does them in about a minute, so those three steps are gone. What is
// left is what Didit does not do: a legal name and date of birth for it to
// check its own OCR against, a phone number for payouts, and a residential
// address (neither KYC workflow includes proof of address).
//
// SAVE AND RESUME still holds, and matters more now rather than less: the two
// steps we own are written to `kyc_drafts` as they are left, and the vendor
// session id is held on the same row, so closing the tab mid-scan returns you
// to the SAME Didit session rather than a second, billable one. Didit's own
// page carries a QR code to move the scan to a phone, which is the device
// change our upload steps existed to survive.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { User } from '@supabase/supabase-js'
import { getBrowserClient } from '@/lib/supabase/client-lazy'
import { KycConsole } from '@/components/kyc/kyc-console'
import { KycStepper, type StepDef } from '@/components/kyc/kyc-stepper'
import { VerificationMeter } from '@/components/kyc/verification-meter'
import { LevelBadge, type KycLevel } from '@/components/kyc/level-badge'
import {
  STEP,
  STEP_COUNT,
  loadDraft,
  saveDraft,
  stepComplete,
  firstIncompleteStep,
  canStartVerification,
  savedAgo,
  isAdult,
  MIN_AGE,
  type KycDraft,
} from '@/lib/kyc/draft'
import {
  IconUser,
  IconHome,
  IconKYC,
  IconShield,
  IconCheck,
  IconArrowRight,
  IconChevronLeft,
  IconClock,
} from '@/components/ui/icons'

const COUNTRIES = [
  { code: 'KE', name: 'Kenya' },
  { code: 'UG', name: 'Uganda' },
  { code: 'TZ', name: 'Tanzania' },
  { code: 'RW', name: 'Rwanda' },
  { code: 'ZM', name: 'Zambia' },
  { code: 'ET', name: 'Ethiopia' },
  { code: 'BI', name: 'Burundi' },
]

const STEPS: StepDef[] = [
  { key: 'identity', label: 'About you', icon: <IconUser size={15} />, desc: 'Name, date of birth, phone' },
  { key: 'address', label: 'Address', icon: <IconHome size={15} />, desc: 'Where you live' },
  { key: 'verify', label: 'ID check', icon: <IconKYC size={15} />, desc: 'Scan your ID and face' },
]

interface SessionStatus {
  providerStatus: string | null
  kycStatus: 'unverified' | 'pending' | 'verified' | 'rejected' | null
  reason?: string | null
}

/** Didit statuses that mean the user still has work to do in the hosted flow. */
const IN_FLIGHT = new Set(['Not Started', 'In Progress', 'Awaiting User', 'Resubmitted'])

interface KycWizardProps {
  user: User
  initialPhone: string
  initialCountry: string
  /** Where to send the user afterwards, so they resume what they were doing (#15). */
  returnTo?: string
}

export function KycWizard({ user, initialPhone, initialCountry, returnTo = '/portfolio' }: KycWizardProps) {
  const [started, setStarted] = useState(false)
  const [step, setStep] = useState<number>(STEP.identity)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState(initialPhone)
  const [dob, setDob] = useState('')
  const [addrLine1, setAddrLine1] = useState('')
  const [addrCity, setAddrCity] = useState('')
  const [addrPostal, setAddrPostal] = useState('')
  const [addrCountry, setAddrCountry] = useState(initialCountry || 'KE')

  const [hydrated, setHydrated] = useState(false)
  const [resumedAt, setResumedAt] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Vendor session state.
  const [opening, setOpening] = useState(false)
  const [checking, setChecking] = useState(false)
  const [session, setSession] = useState<SessionStatus>({ providerStatus: null, kycStatus: null })
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const draft = useMemo<KycDraft>(
    () => ({
      currentStep: step,
      data: { firstName, lastName, phone, dateOfBirth: dob, addrLine1, addrCity, addrPostal, addrCountry },
      didit: { sessionId: null, sessionUrl: null, status: session.providerStatus },
      updatedAt: resumedAt,
    }),
    [step, firstName, lastName, phone, dob, addrLine1, addrCity, addrPostal, addrCountry,
     session.providerStatus, resumedAt],
  )

  const identityOk = stepComplete(draft, STEP.identity)
  const addressOk = stepComplete(draft, STEP.address)
  const level: KycLevel = session.kycStatus === 'verified' ? 'enhanced' : 'basic'
  const canContinue = stepComplete(draft, step)

  // ---- Load any saved draft, once -----------------------------------------
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const supabase = await getBrowserClient()
      const saved = await loadDraft(supabase, user.id, initialPhone, initialCountry)
      if (cancelled) return
      if (saved) {
        setFirstName(saved.data.firstName)
        setLastName(saved.data.lastName)
        setPhone(saved.data.phone)
        setDob(saved.data.dateOfBirth)
        setAddrLine1(saved.data.addrLine1)
        setAddrCity(saved.data.addrCity)
        setAddrPostal(saved.data.addrPostal)
        setAddrCountry(saved.data.addrCountry)
        setSession((s) => ({ ...s, providerStatus: saved.didit.status }))
        // Land on the first GAP, not the furthest step reached.
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

  // ---- Vendor session ------------------------------------------------------

  /**
   * Ask the server what Didit says.
   *
   * The server re-reads the decision with our API key; nothing here trusts the
   * `?from=didit` the browser came back with. That is why this is a fetch and
   * not a read of the URL.
   */
  const check = useCallback(async (): Promise<SessionStatus | null> => {
    setChecking(true)
    try {
      const res = await fetch('/api/kyc/session', { cache: 'no-store' })
      if (!res.ok) return null
      const data = (await res.json()) as SessionStatus
      setSession(data)
      return data
    } catch {
      return null
    } finally {
      setChecking(false)
    }
  }, [])

  // Returning from the hosted flow. Didit's webhook and this poll race, and
  // either may win; both end at the same upsert. Poll because the webhook can
  // be slow, mis-configured or retried, and a user staring at "checking" is
  // the failure they report.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('from') !== 'didit') return

    // Drop the marker so a refresh does not re-enter the polling state.
    const url = new URL(window.location.href)
    url.searchParams.delete('from')
    window.history.replaceState({}, '', url.toString())

    setStarted(true)
    setStep(STEP.verify)

    let tries = 0
    const tick = async () => {
      const result = await check()
      tries += 1
      // Stop on a decision, or after about a minute. Didit's own median is
      // well under that; beyond it the user is better served by a page that
      // says "we will email you" than by a spinner.
      if (result?.kycStatus || tries >= 20) return
      pollTimer.current = setTimeout(() => void tick(), 3000)
    }
    void tick()

    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
  }, [check])

  /** Open (or re-open) the hosted session and hand the user over. */
  const startVerification = async () => {
    setError('')
    setOpening(true)
    try {
      const res = await fetch('/api/kyc/session', { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!res.ok || !body.url) {
        setOpening(false)
        setError(body.error || 'Could not start the ID check. Try again.')
        return
      }
      // Same tab, not a popup: a popup is blocked on most mobile browsers, and
      // the whole flow is designed to be finished on a phone.
      window.location.href = body.url
    } catch {
      setOpening(false)
      setError('Could not start the ID check. Check your connection.')
    }
  }

  const bridge = (
    <div className="space-y-9">
      <VerificationMeter level={level} pending={session.kycStatus === 'pending'} />
      <div>
        <span className="mb-4 block text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          {started ? 'Your progress' : `${STEP_COUNT} quick steps`}
        </span>
        <KycStepper steps={STEPS} current={started ? step : -1} variant="vertical" />
      </div>
    </div>
  )

  // ---- Terminal states from the vendor ------------------------------------
  if (session.kycStatus === 'verified') {
    return (
      <KycConsole bridge={bridge}>
        <Outcome
          tone="good"
          title="Identity verified"
          copy="Deposits, withdrawals and trading are unlocked."
          action={<Link href={returnTo} className="btn btn-primary mt-6">Continue <IconArrowRight size={15} /></Link>}
        />
      </KycConsole>
    )
  }

  if (session.kycStatus === 'pending') {
    return (
      <KycConsole bridge={bridge}>
        <Outcome
          tone="wait"
          title="Under review"
          copy="Your check needs a second look. We'll email you, usually within a few hours."
          action={<Link href={returnTo} className="btn btn-secondary mt-6">Continue</Link>}
        />
      </KycConsole>
    )
  }

  if (session.kycStatus === 'rejected') {
    return (
      <KycConsole bridge={bridge}>
        <Outcome
          tone="bad"
          title="Verification unsuccessful"
          copy={session.reason || 'We could not verify your identity.'}
          action={
            <button type="button" onClick={startVerification} className="btn btn-primary mt-6" disabled={opening}>
              {opening ? 'Opening…' : 'Try again'}
            </button>
          }
        />
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
            A one-time check that unlocks deposits, withdrawals and higher limits. Most people
            finish in about{' '}
            <span className="inline-flex items-center gap-1 font-semibold text-text-primary">
              <IconClock size={13} /> 2 minutes
            </span>
            .
          </p>

          <div className="mt-7 card p-5 sm:p-6">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              What you&apos;ll need
            </h2>
            <ul className="mt-4 space-y-4">
              {[
                { icon: <IconUser size={16} />, t: 'Your details', s: 'Legal name, date of birth, phone' },
                { icon: <IconHome size={16} />, t: 'Your address', s: 'Where you currently live' },
                { icon: <IconKYC size={16} />, t: 'A government ID', s: 'National ID, passport or licence' },
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
              The ID scan runs on Didit, a specialist verification provider. Your document stays
              with them and is never stored on Elopis.
            </span>
          </div>

          <button
            type="button"
            onClick={() => setStarted(true)}
            className="btn btn-primary btn-lg mt-6 w-full sm:w-auto"
          >
            Start verification <IconArrowRight size={16} />
          </button>
        </div>
      </KycConsole>
    )
  }

  // ---- Stepped flow --------------------------------------------------------
  return (
    <KycConsole bridge={bridge}>
      <div className="animate-fade-in">
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
          {resumedAt && (
            <div className="mb-4 flex items-start gap-2.5 rounded-md border border-hairline bg-surface-2 p-3">
              <IconClock size={14} className="mt-0.5 flex-none text-text-muted" />
              <p className="text-xs text-text-secondary">
                Picked up where you left off
                {savedAgo(resumedAt) ? `, saved ${savedAgo(resumedAt)}` : ''}.
              </p>
            </div>
          )}

          <div className="mb-4 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wide text-text-muted">
              Step {step + 1} of {STEP_COUNT}
              {saving ? ' · saving' : ''}
            </span>
            <span className="hidden lg:block">
              <LevelBadge level={level} />
            </span>
          </div>

          {step === STEP.identity && (
            <StepBody
              title="About you"
              copy="Use the name exactly as it appears on your ID. We check it against your document."
            >
              <div className="grid grid-cols-2 gap-3">
                <Field id="kyc-first" label="First name">
                  <input id="kyc-first" className="input w-full" autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Amina" />
                </Field>
                <Field id="kyc-last" label="Last name">
                  <input id="kyc-last" className="input w-full" autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Wanjiru" />
                </Field>
              </div>

              <Field id="kyc-dob" label="Date of birth" className="mt-4">
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
              </Field>

              <Field id="kyc-phone" label="Phone number" className="mt-4">
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
                  <p className="mt-1.5 text-xs text-text-muted">Include your country code.</p>
                )}
              </Field>
            </StepBody>
          )}

          {step === STEP.address && (
            <StepBody title="Residential address" copy="Your current home address.">
              <div className="space-y-3">
                <Field id="addr1" label="Street address">
                  <input id="addr1" className="input w-full" autoComplete="address-line1" value={addrLine1} onChange={(e) => setAddrLine1(e.target.value)} placeholder="123 Ngong Road" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field id="addr-city" label="City">
                    <input id="addr-city" className="input w-full" autoComplete="address-level2" value={addrCity} onChange={(e) => setAddrCity(e.target.value)} placeholder="Nairobi" />
                  </Field>
                  <Field id="addr-postal" label="Postal code (optional)">
                    <input id="addr-postal" className="input w-full" autoComplete="postal-code" value={addrPostal} onChange={(e) => setAddrPostal(e.target.value)} placeholder="00100" />
                  </Field>
                </div>
                <Field id="addr-country" label="Country">
                  <select id="addr-country" className="input w-full" value={addrCountry} onChange={(e) => setAddrCountry(e.target.value)}>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </StepBody>
          )}

          {step === STEP.verify && (
            <StepBody
              title="Scan your ID"
              copy="You'll photograph your document and your face. It takes about a minute and opens on this device or your phone."
            >
              <ul className="divide-y divide-hairline rounded-md border border-hairline">
                {[
                  ['Document check', 'Confirms the ID is genuine and reads your details'],
                  ['Face check', 'Confirms you are a live person and match the document'],
                ].map(([t, s]) => (
                  <li key={t} className="flex items-start gap-3 p-3.5">
                    <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-pill bg-pip-100 text-pip-500">
                      <IconCheck size={11} strokeWidth={2.5} />
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-text-primary">{t}</span>
                      <span className="block text-xs text-text-muted">{s}</span>
                    </span>
                  </li>
                ))}
              </ul>

              {/* Mid-flight: they opened the session and came back without a
                  decision. Say so, and offer the SAME session rather than a
                  second billable one. */}
              {session.providerStatus && IN_FLIGHT.has(session.providerStatus) && !checking && (
                <p className="mt-4 rounded-md border border-hairline bg-surface-2 p-3 text-xs text-text-secondary">
                  Your check is open but not finished. Continuing takes you back to where you
                  stopped.
                </p>
              )}
              {checking && (
                <p className="mt-4 text-xs text-text-muted" aria-live="polite">
                  Checking your result…
                </p>
              )}

              <button
                type="button"
                onClick={startVerification}
                className="btn btn-primary btn-lg mt-5 w-full"
                disabled={opening || checking || !canStartVerification(draft)}
              >
                {opening ? 'Opening…' : session.providerStatus && IN_FLIGHT.has(session.providerStatus) ? 'Continue ID check' : 'Start ID check'}
                <IconArrowRight size={16} />
              </button>
            </StepBody>
          )}

          {error && (
            <div role="alert" aria-live="assertive" className="mt-4 rounded-md border border-no/30 bg-no/10 p-3 text-xs text-no">
              {error}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                if (step === STEP.identity) return setStarted(false)
                const prev = step - 1
                setStep(prev)
                void persist(prev)
              }}
              className="btn btn-ghost btn-sm gap-1"
            >
              <IconChevronLeft size={15} /> Back
            </button>

            {step < STEP.verify && (
              <button
                type="button"
                onClick={() => {
                  const next = step + 1
                  setStep(next)
                  // Written as the step is LEFT, not on every keystroke.
                  void persist(next)
                }}
                className="btn btn-primary"
                disabled={!canContinue}
              >
                Continue <IconArrowRight size={15} />
              </button>
            )}
          </div>
        </div>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-text-muted">
          <IconShield size={12} /> Encrypted end-to-end · ID scan handled by Didit
        </p>

        {/* Completeness is also what the meter reads, so keep the two honest. */}
        <span className="sr-only">
          {identityOk ? 'Details complete.' : 'Details incomplete.'}{' '}
          {addressOk ? 'Address complete.' : 'Address incomplete.'}
        </span>
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

function Field({ id, label, className = '', children }: { id: string; label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </label>
      {children}
    </div>
  )
}

function Outcome({
  tone,
  title,
  copy,
  action,
}: {
  tone: 'good' | 'wait' | 'bad'
  title: string
  copy: string
  action: React.ReactNode
}) {
  const skin = {
    good: { wrap: 'bg-yes/10 text-yes-700', icon: <IconCheck size={30} strokeWidth={2.5} /> },
    wait: { wrap: 'bg-brass-100 text-brass-600', icon: <IconClock size={28} /> },
    bad: { wrap: 'bg-no/10 text-no', icon: <IconShield size={28} /> },
  }[tone]
  return (
    <div className="card animate-scale-in p-8 text-center sm:p-10">
      <div className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-pill ${skin.wrap}`}>
        {skin.icon}
      </div>
      <h2 className="font-display text-2xl text-text-primary">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-secondary">{copy}</p>
      {action}
    </div>
  )
}
