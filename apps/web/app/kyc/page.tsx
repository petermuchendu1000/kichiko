'use client'

// app/kyc/page.tsx — Identity verification (Verification Console)
// Thin client wrapper: guards auth, resolves the current KYC status, and hands off
// to the KycWizard. Verified / pending users see a terminal state re-skinned onto
// the same two-pane console for visual continuity.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'
import { createClient } from '@/lib/supabase/client'
import { KycWizard } from '@/components/kyc/kyc-wizard'
import { KycConsole } from '@/components/kyc/kyc-console'
import { VerificationMeter } from '@/components/kyc/verification-meter'
import { LevelBadge } from '@/components/kyc/level-badge'
import { IconCheck, IconClock, IconShield, IconArrowRight } from '@/components/ui/icons'
import { safeRedirectPath } from '@/lib/security/sanitize'

export default function KYCPage() {
  const { user, profile, loading } = useAuth()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  // Where to return the user after verifying, so they resume what they were
  // doing instead of dead-ending on a confirmation (#15). Sanitized against
  // open redirects; defaults to the portfolio.
  const [returnTo] = useState(() =>
    typeof window !== 'undefined'
      ? safeRedirectPath(new URLSearchParams(window.location.search).get('next') || '/portfolio')
      : '/portfolio',
  )

  const [status, setStatus] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!loading && !user) router.push('/auth/login')
  }, [user, loading, router])

  useEffect(() => {
    if (!user) return
    supabase
      .from('kyc_documents')
      .select('status')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        setStatus(data?.status ?? profile?.kyc_status ?? 'unverified')
        setReady(true)
      })
  }, [user, profile, supabase])

  // ---- Loading -------------------------------------------------------------
  if (loading || !user || !ready) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <div className="skeleton h-8 w-48 rounded-md" />
        <div className="skeleton mt-6 h-64 w-full rounded-md" />
      </div>
    )
  }

  // ---- Verified ------------------------------------------------------------
  if (status === 'verified') {
    return (
      <KycConsole bridge={<TerminalBridge state="verified" />}>
        <div className="card animate-scale-in p-8 text-center sm:p-10">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-pill bg-yes/10 text-yes-700">
            <IconCheck size={30} strokeWidth={2.5} />
          </div>
          <div className="mb-3 flex justify-center">
            <LevelBadge level="enhanced" />
          </div>
          <h1 className="font-display text-2xl text-text-primary">Identity verified</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-secondary">
            You&apos;re fully verified — all deposit, withdrawal and trading features are unlocked.
          </p>
          <Link href={returnTo} className="btn btn-primary mt-6">
            Continue <IconArrowRight size={15} />
          </Link>
        </div>
      </KycConsole>
    )
  }

  // ---- Pending -------------------------------------------------------------
  if (status === 'pending') {
    return (
      <KycConsole bridge={<TerminalBridge state="pending" />}>
        <div className="card animate-scale-in p-8 text-center sm:p-10">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-pill bg-brass-100 text-brass-600">
            <IconClock size={28} />
          </div>
          <div className="mb-3 flex justify-center">
            <LevelBadge level="enhanced" pending />
          </div>
          <h1 className="font-display text-2xl text-text-primary">Under review</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-secondary">
            Your documents are with our compliance team. This usually takes 1–2 business days, and
            we&apos;ll email you as soon as you&apos;re verified.
          </p>
          <div className="mx-auto mt-6 flex max-w-xs items-center justify-center gap-1.5 rounded-md border border-hairline bg-surface-2 px-3 py-2 text-xs text-text-muted">
            <IconShield size={13} className="text-pip-500" /> Your documents are encrypted and private.
          </div>
          <Link href={returnTo} className="btn btn-secondary mt-6">
            Continue
          </Link>
        </div>
      </KycConsole>
    )
  }

  // ---- Unverified → wizard -------------------------------------------------
  return (
    <KycWizard
      user={user}
      initialPhone={profile?.phone_number ?? ''}
      initialCountry={profile?.country_code ?? 'KE'}
      returnTo={returnTo}
    />
  )
}

function TerminalBridge({ state }: { state: 'verified' | 'pending' }) {
  return (
    <div className="space-y-9">
      <VerificationMeter level="enhanced" pending={state === 'pending'} />
      <div className="rounded-md border border-hairline bg-surface p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          {state === 'verified' ? (
            <>
              <span className="flex h-6 w-6 items-center justify-center rounded-pill bg-yes/10 text-yes-700">
                <IconCheck size={13} strokeWidth={2.5} />
              </span>
              All checks complete
            </>
          ) : (
            <>
              <span className="flex h-6 w-6 items-center justify-center rounded-pill bg-brass-100 text-brass-600">
                <IconClock size={13} />
              </span>
              Awaiting review
            </>
          )}
        </p>
        <p className="mt-1.5 text-xs leading-snug text-text-muted">
          {state === 'verified'
            ? 'Enhanced verification unlocks full deposits, withdrawals and the highest limits.'
            : 'A compliance officer is reviewing your documents. No further action is needed.'}
        </p>
      </div>
    </div>
  )
}
