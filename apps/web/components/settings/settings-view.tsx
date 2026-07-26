'use client'

// Account settings hub. Sections:
//   • Account  — display name, username, bio, phone, country, display currency
//                (persisted via PATCH /api/profile)
//   • Security — change password (Supabase updateUser) + email-link fallback
//   • Notifications — reuses the shared delivery-preferences control
//   • Language — reuses the shared locale switcher (cookie + profile persistence)
//   • Verification — KYC status + link into the KYC flow
//   • Referral — shareable code with copy
//   • Session — sign out
// Pip design system; no emoji, no external UI kit. All colour via CSS vars +
// tailwind tokens already used across the app.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { NotificationPreferences } from '@/components/notifications/NotificationPreferences'
import { LocaleSwitcher } from '@/components/layout/locale-switcher'
import { PasswordInput } from '@/components/auth/password-input'
import {
  IconUser,
  IconKey,
  IconBell,
  IconGlobe,
  IconShield,
  IconLink,
  IconLogOut,
  IconCheck,
  IconCopy,
  IconChevronRight,
} from '@/components/ui/icons'

const CURRENCIES = ['KES', 'UGX', 'TZS', 'RWF', 'ZMW', 'ETB', 'BIF', 'USD'] as const

type Profile = {
  display_name: string | null
  username: string | null
  bio: string | null
  phone_number: string | null
  country_code: string | null
  preferred_currency: string | null
  avatar_url: string | null
  kyc_status: string | null
  account_status: string | null
  referral_code: string | null
}

type Banner = { kind: 'ok' | 'err'; text: string } | null

function SectionCard({
  icon,
  title,
  desc,
  children,
}: {
  icon: React.ReactNode
  title: string
  desc?: string
  children: React.ReactNode
}) {
  return (
    <section className="card p-5">
      <header className="mb-4 flex items-start gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'var(--surface-2)', color: 'var(--pip-500)' }}
          aria-hidden="true"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h2>
          {desc && (
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              {desc}
            </p>
          )}
        </div>
      </header>
      {children}
    </section>
  )
}

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-xs font-semibold uppercase tracking-wide"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

function InlineBanner({ banner }: { banner: Banner }) {
  if (!banner) return null
  const ok = banner.kind === 'ok'
  return (
    <div
      role={ok ? 'status' : 'alert'}
      aria-live={ok ? 'polite' : 'assertive'}
      className={`mt-3 flex items-center gap-2 rounded-md border p-3 text-xs ${
        ok ? 'border-yes/30 bg-yes/10 text-yes' : 'border-no/30 bg-no/10 text-no'
      }`}
    >
      {ok && <IconCheck size={14} />}
      <span>{banner.text}</span>
    </div>
  )
}

export function SettingsView() {
  const router = useRouter()
  const supabase = createClient()

  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState<string>('')
  const [profile, setProfile] = useState<Profile | null>(null)

  // Account form state
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [phone, setPhone] = useState('')
  const [country, setCountry] = useState('')
  const [currency, setCurrency] = useState('')
  const [savingAccount, setSavingAccount] = useState(false)
  const [accountBanner, setAccountBanner] = useState<Banner>(null)
  const [avatarUrl, setAvatarUrl] = useState('')
  const [userId, setUserId] = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  // Security form state
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [savingPw, setSavingPw] = useState(false)
  const [pwBanner, setPwBanner] = useState<Banner>(null)

  const [copied, setCopied] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/profile', { cache: 'no-store' })
        const json = await res.json()
        if (!active) return
        if (res.ok) {
          const p: Profile = json.profile
          setProfile(p)
          setEmail(json.email ?? '')
          setDisplayName(p.display_name ?? '')
          setUsername(p.username ?? '')
          setBio(p.bio ?? '')
          setPhone(p.phone_number ?? '')
          setCountry(p.country_code ?? '')
          setCurrency(p.preferred_currency ?? '')
          setAvatarUrl(p.avatar_url ?? '')
          const { data: u } = await supabase.auth.getUser()
          if (active && u?.user) setUserId(u.user.id)
        }
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
    // supabase client is stable across renders; intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const saveAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    setAccountBanner(null)
    setSavingAccount(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName,
          username,
          bio,
          phone_number: phone,
          country_code: country,
          preferred_currency: currency || undefined,
        }),
      })
      const json = await res.json()
      if (res.ok) {
        setProfile(json.profile)
        setAccountBanner({ kind: 'ok', text: 'Profile saved.' })
      } else {
        setAccountBanner({ kind: 'err', text: json.error ?? 'Could not save your profile.' })
      }
    } catch {
      setAccountBanner({ kind: 'err', text: 'Network error. Please try again.' })
    } finally {
      setSavingAccount(false)
    }
  }

  // Upload a new profile photo to the owner-scoped `avatars` bucket, then
  // persist its public URL on the profile. Path is prefixed with the user id so
  // the storage RLS policy authorises the write.
  const uploadAvatar = async (file: File) => {
    setAccountBanner(null)
    if (!userId) {
      setAccountBanner({ kind: 'err', text: 'Still loading your account. Please try again in a moment.' })
      return
    }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setAccountBanner({ kind: 'err', text: 'Use a JPEG, PNG or WebP image.' })
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setAccountBanner({ kind: 'err', text: 'Image must be 2MB or smaller.' })
      return
    }
    setUploadingAvatar(true)
    try {
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
      const path = `${userId}/avatar-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, cacheControl: '3600', contentType: file.type })
      if (upErr) throw new Error(upErr.message)
      const publicUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_url: publicUrl }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not save your photo.')
      setProfile(json.profile)
      setAvatarUrl(publicUrl)
      setAccountBanner({ kind: 'ok', text: 'Profile photo updated.' })
    } catch (err) {
      setAccountBanner({ kind: 'err', text: err instanceof Error ? err.message : 'Upload failed. Please try again.' })
    } finally {
      setUploadingAvatar(false)
    }
  }

  const removeAvatar = async () => {
    setAccountBanner(null)
    setUploadingAvatar(true)
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatar_url: '' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Could not remove your photo.')
      setProfile(json.profile)
      setAvatarUrl('')
      setAccountBanner({ kind: 'ok', text: 'Profile photo removed.' })
    } catch (err) {
      setAccountBanner({ kind: 'err', text: err instanceof Error ? err.message : 'Could not remove your photo.' })
    } finally {
      setUploadingAvatar(false)
    }
  }

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwBanner(null)
    if (pw.length < 8) {
      setPwBanner({ kind: 'err', text: 'Password must be at least 8 characters.' })
      return
    }
    if (pw !== pw2) {
      setPwBanner({ kind: 'err', text: 'Passwords do not match.' })
      return
    }
    setSavingPw(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setSavingPw(false)
    if (error) {
      setPwBanner({ kind: 'err', text: error.message })
      return
    }
    setPw('')
    setPw2('')
    setPwBanner({ kind: 'ok', text: 'Password updated.' })
  }

  const copyReferral = async () => {
    if (!profile?.referral_code) return
    try {
      await navigator.clipboard.writeText(profile.referral_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  const signOut = async () => {
    setSigningOut(true)
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="h-8 w-40 animate-pulse rounded-md" style={{ background: 'var(--surface-2)' }} />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl" style={{ background: 'var(--surface-2)' }} />
        ))}
      </div>
    )
  }

  const kyc = profile?.kyc_status ?? 'unverified'
  const kycVerified = kyc === 'verified'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl" style={{ color: 'var(--text-primary)' }}>
          Settings
        </h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Manage your account, security, and preferences.
        </p>
      </div>

      {/* ACCOUNT */}
      <SectionCard icon={<IconUser size={17} />} title="Account" desc="Your public identity and contact details.">
        <form onSubmit={saveAccount} className="space-y-4">
          {/* Profile photo — upload / replace / remove. */}
          <div className="flex items-center gap-4">
            <span className="relative inline-flex h-16 w-16 flex-none overflow-hidden rounded-full border border-hairline bg-surface-2">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="Your avatar" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-text-muted">
                  <IconUser size={26} />
                </span>
              )}
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className={`btn btn-ghost btn-sm inline-flex cursor-pointer items-center gap-1.5 ${
                    uploadingAvatar ? 'pointer-events-none opacity-60' : ''
                  }`}
                >
                  {uploadingAvatar ? 'Uploading…' : avatarUrl ? 'Change photo' : 'Upload photo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    disabled={uploadingAvatar}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) uploadAvatar(f)
                      e.target.value = ''
                    }}
                  />
                </label>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={removeAvatar}
                    disabled={uploadingAvatar}
                    className="btn btn-ghost btn-sm text-text-secondary"
                  >
                    Remove
                  </button>
                )}
              </div>
              <p className="text-xs text-text-muted">JPEG, PNG or WebP, up to 2MB.</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Display name" htmlFor="display_name">
              <input
                id="display_name"
                className="input w-full"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={60}
                placeholder="Your name"
              />
            </Field>
            <Field label="Username" htmlFor="username" hint="Letters, numbers, underscores.">
              <input
                id="username"
                className="input w-full"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={30}
                placeholder="username"
                autoCapitalize="none"
                spellCheck={false}
              />
            </Field>
          </div>

          <Field label="Bio" htmlFor="bio" hint={`${bio.length}/280`}>
            <textarea
              id="bio"
              className="input w-full"
              rows={3}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={280}
              placeholder="A short line about you"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Phone" htmlFor="phone">
              <input
                id="phone"
                className="input w-full"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                placeholder="+254…"
              />
            </Field>
            <Field label="Country" htmlFor="country" hint="2-letter code">
              <input
                id="country"
                className="input w-full uppercase"
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
                maxLength={2}
                placeholder="KE"
              />
            </Field>
            <Field label="Display currency" htmlFor="currency">
              <select
                id="currency"
                className="input w-full"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                <option value="">Auto</option>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Email" htmlFor="email" hint="Contact support to change your email.">
            <input id="email" className="input w-full" value={email} disabled readOnly />
          </Field>

          <InlineBanner banner={accountBanner} />

          <div className="flex justify-end">
            <button type="submit" className="btn btn-primary btn-sm" disabled={savingAccount}>
              {savingAccount ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </SectionCard>

      {/* SECURITY */}
      <SectionCard icon={<IconKey size={17} />} title="Security" desc="Change your password.">
        <form onSubmit={savePassword} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New password" htmlFor="new_pw">
              <PasswordInput id="new_pw" value={pw} onChange={setPw} autoComplete="new-password" placeholder="At least 8 characters" />
            </Field>
            <Field label="Confirm password" htmlFor="confirm_pw">
              <PasswordInput id="confirm_pw" value={pw2} onChange={setPw2} autoComplete="new-password" placeholder="Re-enter password" />
            </Field>
          </div>

          <InlineBanner banner={pwBanner} />

          <div className="flex items-center justify-between">
            <Link href="/auth/reset-password" className="text-xs font-medium text-pip-500 hover:underline">
              Reset via email instead
            </Link>
            <button type="submit" className="btn btn-primary btn-sm" disabled={savingPw}>
              {savingPw ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </form>
      </SectionCard>

      {/* NOTIFICATIONS */}
      <SectionCard icon={<IconBell size={17} />} title="Notifications" desc="Choose how we reach you.">
        <NotificationPreferences />
      </SectionCard>

      {/* LANGUAGE */}
      <SectionCard icon={<IconGlobe size={17} />} title="Language" desc="Your preferred display language.">
        <LocaleSwitcher />
      </SectionCard>

      {/* VERIFICATION */}
      <SectionCard icon={<IconShield size={17} />} title="Verification" desc="Identity verification unlocks higher limits.">
        <Link
          href="/kyc"
          className="flex items-center justify-between rounded-lg border p-3 transition-colors hover:bg-[var(--surface-2)]"
          style={{ borderColor: 'var(--hairline)' }}
        >
          <span className="flex items-center gap-3">
            <span
              className="rounded-pill px-2.5 py-1 text-xs font-semibold capitalize"
              style={{
                background: kycVerified ? 'var(--yes-tint)' : 'var(--surface-2)',
                color: kycVerified ? 'var(--yes-text)' : 'var(--text-secondary)',
              }}
            >
              {kyc}
            </span>
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
              {kycVerified ? 'Your identity is verified' : 'Complete identity verification'}
            </span>
          </span>
          <IconChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
        </Link>
      </SectionCard>

      {/* REFERRAL */}
      {profile?.referral_code && (
        <SectionCard icon={<IconLink size={17} />} title="Referral code" desc="Invite friends and earn rewards.">
          <div className="flex items-center justify-between rounded-lg border p-3" style={{ borderColor: 'var(--hairline)' }}>
            <span className="mono text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {profile.referral_code}
            </span>
            <button type="button" onClick={copyReferral} className="btn btn-ghost btn-sm inline-flex items-center gap-1.5">
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </SectionCard>
      )}

      {/* SESSION */}
      <SectionCard icon={<IconLogOut size={17} />} title="Session" desc="Sign out of this device.">
        <button type="button" onClick={signOut} className="btn btn-ghost btn-sm inline-flex items-center gap-2" disabled={signingOut}>
          <IconLogOut size={15} />
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </SectionCard>
    </div>
  )
}
