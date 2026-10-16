'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'
import { useWallets } from '@/hooks/use-wallets'
import { getBrowserClient } from '@/lib/supabase/client-lazy'
import { amountInWords } from '@/lib/money-words'
import { phoneKey } from '@/lib/payments/verified-phones'
import type { FundingStep } from '@/lib/payments/funding-steps'
import { CURRENCIES, type CurrencyCode } from '@/types'
import { depositPresets, phonePlaceholder, phonePrefill, isValidPhone, depositRequestBody, withdrawRequestBody } from '@/lib/payments/deposit-ux'
import { readJson } from '@/lib/http/client'
import { openAuthDialog } from '@/lib/auth-dialog-bus'
import { StkPushLoader } from '@/components/payments/stk-push-loader'
import {
  LogoMark,
  IconSearch, IconBell, IconUser, IconX,
  IconWallet, IconDeposit, IconWithdraw, IconPortfolio,
  IconSettings, IconLogOut, IconLeaderboard, IconShield,
  IconMarkets, IconChevronDown, IconTrophy,
} from '@/components/ui/icons'
import { ThemeToggle } from '@/components/ui/theme-toggle'

export function Navbar() {
  const pathname = usePathname()
  const router = useRouter()
  const { user, profile, loading } = useAuth()
  // Elevated roles get a link to their self-service console. `UserRole` now
  // aliases the full DB user_role enum, so these compare against enum literals.
  const role = profile?.role
  const canCreatorConsole = role === 'creator' || role === 'admin' || role === 'superadmin'
  const canMarketerConsole = role === 'marketer' || role === 'admin' || role === 'superadmin'
  const { wallets, preferredCurrency } = useWallets()
  // Sign-out is the only thing the navbar needs a client for, and it is a
  // click. Loading it during render would put ~66 kB on every page in the
  // product, since this is in the layout. Ruling A11.

  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [depositOpen, setDepositOpen] = useState(false)
  const [depositAmount, setDepositAmount] = useState('')
  // When the deposit is opened to fund a trade the user was placing, we carry an
  // 'order' intent so the sheet can resume the order once payment is confirmed.
  const [depositIntent, setDepositIntent] = useState<'order' | null>(null)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  // Deferred funding intent (friction #13): when a logged-out user triggers
  // "Add funds"/"Withdraw", we open the auth dialog first and stash the intent
  // here, then complete it automatically once they're signed in.
  const [pendingDeposit, setPendingDeposit] = useState<string | null>(null)
  const [pendingWithdraw, setPendingWithdraw] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  // Latest auth state for use inside stable (deps-[]) event handlers.
  const userRef = useRef(user)
  userRef.current = user

  const wallet = wallets.find(w => w.currency === preferredCurrency)
  const balance = wallet?.available_balance ?? 0
  const currencyInfo = CURRENCIES[preferredCurrency]

  // Let any surface (e.g. the betting panel's "Add funds" CTA) open the deposit
  // sheet without prop-drilling, via a decoupled global event. An optional
  // `amountLocal` in the event prefills the sheet to the exact stake shortfall.
  useEffect(() => {
    const openDeposit = (e: Event) => {
      const detail = (e as CustomEvent).detail as { amountLocal?: number; intent?: 'order' } | undefined
      const amt = detail?.amountLocal
      const amtStr = amt && amt > 0 ? String(Math.ceil(amt)) : ''
      setDepositIntent(detail?.intent ?? null)
      // Logged out → authenticate first, then resume the deposit (no dead-end
      // where they fill the sheet only to hit a 401 on submit).
      if (!userRef.current) {
        setPendingDeposit(amtStr)
        openAuthDialog({ reason: 'Sign in to deposit to your wallet' })
        return
      }
      setDepositAmount(amtStr)
      setDepositOpen(true)
    }
    window.addEventListener('elopis:open-deposit', openDeposit)
    return () => window.removeEventListener('elopis:open-deposit', openDeposit)
  }, [])

  // Symmetric global opener for the withdraw sheet (e.g. from the portfolio).
  useEffect(() => {
    const openWithdraw = () => {
      if (!userRef.current) {
        setPendingWithdraw(true)
        openAuthDialog({ reason: 'Sign in to withdraw your funds' })
        return
      }
      setWithdrawOpen(true)
    }
    window.addEventListener('elopis:open-withdraw', openWithdraw)
    return () => window.removeEventListener('elopis:open-withdraw', openWithdraw)
  }, [])

  // Resume a deferred funding intent once the user is authenticated (#13).
  useEffect(() => {
    if (!user) return
    if (pendingDeposit !== null) {
      setDepositAmount(pendingDeposit)
      setDepositOpen(true)
      setPendingDeposit(null)
    }
    if (pendingWithdraw) {
      setWithdrawOpen(true)
      setPendingWithdraw(false)
    }
  }, [user, pendingDeposit, pendingWithdraw])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const signOut = async () => {
    const supabase = await getBrowserClient()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  const navLinks = [
    { href: '/markets', label: 'Events', icon: <IconMarkets size={15}/> },
  ]

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

  return (
    <>
      <nav className={`navbar transition-shadow ${scrolled ? 'shadow-lg' : ''}`}>
        <div className="max-w-[1350px] mx-auto px-4 lg:px-6 h-14 flex items-center gap-3">

          {/* Logo + company name — the name now sits next to the mark on every
              breakpoint (previously hidden on the smallest screens). */}
          <Link href="/" className="flex items-center gap-2 mr-1 sm:mr-2 flex-shrink-0" aria-label="Elopis home">
            <LogoMark size={28} />
            <span className="font-display text-[15px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>
              Elopis
            </span>
          </Link>

          {/* Desktop nav links.
              transition-colors, not transition-all: `all` animates the focus
              outline too, so tabbing to this link grew its ring from 0 to 2px
              over 150ms (measured: 0px at t+0, 1px at t+50, 2px at t+120).
              The ring arrived, late and faint — which is not what WCAG 2.4.11
              asks of an indicator, and it is the one thing on this page that
              should never fade in. */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                  isActive(link.href)
                    ? 'bg-[var(--pip-100)] text-[var(--pip-text)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
                }`}
              >
                {link.icon}{link.label}
              </Link>
            ))}
          </div>

          {/* Search bar — desktop */}
          <div className="hidden md:flex flex-1 max-w-xs mx-2">
            <button
              onClick={() => router.push('/search')}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-muted)] text-sm hover:border-[var(--border-hover)] transition-colors"
            >
              <IconSearch size={14} />
              <span>Search events…</span>
              <span className="ml-auto text-xs border border-[var(--border)] rounded px-1 py-0.5 font-mono">/</span>
            </button>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2 ml-auto">

            {/* Light/dark switch — desktop only; on mobile it lives in the
                "More" menu to declutter the top bar. */}
            <span className="hidden md:inline-flex">
              <ThemeToggle />
            </span>

            {!loading && (
              <>
                {user ? (
                  <>
                    {/* Wallet balance chip */}
                    <button
                      onClick={() => setDepositOpen(true)}
                      className="wallet-chip hidden sm:flex"
                      title="Deposit funds"
                    >
                      <IconWallet size={13} />
                      <span className="font-mono">
                        {currencyInfo?.symbol}{balance.toLocaleString()}
                      </span>
                      <span className="text-[10px] opacity-70">{preferredCurrency}</span>
                    </button>

                    {/* Notifications — desktop only; on mobile it lives in the
                        "More" menu to declutter the top bar. */}
                    <Link
                      href="/notifications"
                      className="relative hidden md:inline-flex p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                      aria-label="Notifications"
                    >
                      <IconBell size={17} className="text-[var(--text-secondary)]" />
                      <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: 'var(--pip-500)' }} />
                    </Link>

                    {/* User (profile) menu — desktop only; on mobile the profile
                        actions live in the "More" menu to declutter the top bar. */}
                    <div className="relative hidden md:block" ref={menuRef}>
                      <button
                        onClick={() => setUserMenuOpen(v => !v)}
                        className="flex items-center gap-1.5 p-1 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                      >
                        <div className="avatar">
                          {(user.email?.[0] ?? 'U').toUpperCase()}
                        </div>
                        <IconChevronDown size={13} className="text-[var(--text-muted)] hidden sm:block" />
                      </button>

                      {userMenuOpen && (
                        <div className="dropdown animate-scale-in" style={{ minWidth: 220 }}>
                          {/* Header */}
                          <div className="px-4 py-3 border-b border-[var(--border)]">
                            <p className="text-xs text-[var(--text-muted)]">Signed in as</p>
                            <p className="text-sm font-semibold truncate text-[var(--text-primary)]">{user.email}</p>
                          </div>

                          {/* Wallet (mobile) */}
                          <div className="sm:hidden px-4 py-2 border-b border-[var(--border)]">
                            <p className="text-xs text-[var(--text-muted)] mb-1">Balance</p>
                            <p className="font-mono font-bold" style={{ color: 'var(--text)' }}>
                              {currencyInfo?.symbol}{balance.toLocaleString()} {preferredCurrency}
                            </p>
                          </div>

                          <div className="py-1">
                            <button onClick={() => { setDepositOpen(true); setUserMenuOpen(false) }} className="dropdown-item w-full">
                              <IconDeposit size={15} /><span>Deposit</span>
                            </button>
                            <button onClick={() => { setWithdrawOpen(true); setUserMenuOpen(false) }} className="dropdown-item w-full">
                              <IconWithdraw size={15} /><span>Withdraw</span>
                            </button>
                            <Link href="/portfolio" className="dropdown-item" onClick={() => setUserMenuOpen(false)}>
                              <IconPortfolio size={15} /><span>Portfolio</span>
                            </Link>
                            <Link href="/profile" className="dropdown-item" onClick={() => setUserMenuOpen(false)}>
                              <IconUser size={15} /><span>Profile</span>
                            </Link>
                            <Link href="/kyc" className="dropdown-item" onClick={() => setUserMenuOpen(false)}>
                              <IconShield size={15} /><span>Verify Identity</span>
                            </Link>
                            {canMarketerConsole && (
                              <Link href="/marketer" className="dropdown-item" onClick={() => setUserMenuOpen(false)}>
                                <IconTrophy size={15} /><span>Marketer Console</span>
                              </Link>
                            )}
                            {canCreatorConsole && (
                              <Link href="/creator" className="dropdown-item" onClick={() => setUserMenuOpen(false)}>
                                <IconMarkets size={15} /><span>Creator Console</span>
                              </Link>
                            )}
                            <Link href="/settings" className="dropdown-item" onClick={() => setUserMenuOpen(false)}>
                              <IconSettings size={15} /><span>Settings</span>
                            </Link>
                          </div>

                          <div className="py-1 border-t border-[var(--border)]">
                            <button onClick={signOut} className="dropdown-item danger w-full">
                              <IconLogOut size={15} /><span>Sign out</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <Link href="/auth/login" className="btn btn-ghost btn-sm">Sign in</Link>
                    <Link href="/auth/register" className="btn btn-primary btn-sm">Get started</Link>
                  </div>
                )}
              </>
            )}

            {/* Mobile navigation lives entirely in the bottom nav (Home ·
                Search · Breaking · More) — the redundant top-bar search icon and
                the ☰ hamburger/menu were removed to declutter the mobile chrome. */}
          </div>
        </div>
      </nav>

      {/* Deposit modal placeholder — swap for real modal */}
      {depositOpen && (
        <DepositSheet onClose={() => { setDepositOpen(false); setDepositIntent(null) }} initialAmount={depositAmount} resumeOrder={depositIntent === 'order'} />
      )}
      {withdrawOpen && (
        <WithdrawSheet onClose={() => setWithdrawOpen(false)} balance={balance} currency={preferredCurrency} />
      )}
    </>
  )
}

// Inline deposit sheet (lightweight, no heavy modal lib)
function DepositSheet({ onClose, initialAmount, resumeOrder = false }: { onClose: () => void; initialAmount?: string; resumeOrder?: boolean }) {
  const { preferredCurrency, refreshWallets } = useWallets()
  const router = useRouter()
  const [amount, setAmount] = useState(initialAmount ?? '')
  // Prefill the phone with the country dial code so the user only types the
  // local part (friction #10); presets and placeholder are currency-aware (#9/#10).
  const [phone, setPhone] = useState(() => phonePrefill(preferredCurrency))
  const [phoneError, setPhoneError] = useState('')
  const presets = depositPresets(preferredCurrency)
  const curSymbol = CURRENCIES[preferredCurrency]?.symbol ?? preferredCurrency
  // Shared with WithdrawSheet so the two flows cannot diverge in length (E5).
  const [step, setStep] = useState<FundingStep>('form')
  const [error, setError] = useState('')
  // STK-push confirmation state (friction #8): after the push we don't dead-end
  // on "Check your phone" — we poll the deposit status and reflect the real
  // outcome (credited / failed / still-waiting) in-app, then refresh the wallet.
  const [depositId, setDepositId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<'waiting' | 'credited' | 'failed' | 'timeout'>('waiting')
  const [confirmReason, setConfirmReason] = useState('')

  // Close on Escape for keyboard users (backdrop click handles pointer dismissal).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Poll the deposit status once we're on the success screen with an id. The
  // STK push is confirmed asynchronously by the provider webhook, so we check
  // every 3s for ~90s. Terminal states (completed/failed/refunded) stop the
  // poll; a timeout leaves a reassuring "still processing" message (never a
  // dead-end). On credit we refresh the wallet so the new balance shows.
  useEffect(() => {
    if (step !== 'success' || !depositId || confirm !== 'waiting') return
    let active = true
    let tries = 0
    const MAX_TRIES = 30 // 30 × 3s = 90s
    const tick = async () => {
      if (!active) return
      tries += 1
      try {
        const res = await fetch(`/api/payments/deposit?id=${encodeURIComponent(depositId)}`)
        const body = await readJson<{ data?: { status?: string; failure_reason?: string } }>(res)
        const status: string | undefined = body?.data?.status
        if (!active) return
        if (status === 'completed') {
          setConfirm('credited')
          await refreshWallets()
          return
        }
        if (status === 'failed' || status === 'refunded') {
          setConfirm('failed')
          setConfirmReason(body?.data?.failure_reason || 'The payment was not completed.')
          return
        }
      } catch {
        // Transient network error — keep polling; don't dead-end.
      }
      if (!active) return
      if (tries >= MAX_TRIES) { setConfirm('timeout'); return }
      timer = setTimeout(tick, 3000)
    }
    let timer = setTimeout(tick, 3000)
    return () => { active = false; clearTimeout(timer) }
  }, [step, depositId, confirm, refreshWallets])

  const resetForm = () => {
    setStep('form'); setError(''); setDepositId(null)
    setConfirm('waiting'); setConfirmReason('')
  }

  // Once the deposit is credited AND it was opened to fund a trade the user was
  // placing, hand back to the ticket: broadcast so it can place the order, then
  // close the sheet after a short beat (the "…then place the order" step).
  useEffect(() => {
    if (confirm !== 'credited' || !resumeOrder) return
    window.dispatchEvent(new CustomEvent('elopis:deposit-credited'))
    const t = setTimeout(() => onClose(), 1400)
    return () => clearTimeout(t)
  }, [confirm, resumeOrder, onClose])

  const review = () => {
    if (!amount || !phone) return
    if (!isValidPhone(phone, preferredCurrency)) {
      setPhoneError(`Enter a valid ${preferredCurrency} mobile number, e.g. ${phonePlaceholder(preferredCurrency)}`)
      return
    }
    setPhoneError(''); setError('')
    setStep('review')
  }

  const submit = async () => {
    if (!amount || !phone) return
    // Validate the phone up-front so the user gets an inline hint instead of a
    // gateway 400 (friction #10). Send the canonical E.164 form to the API.
    if (!isValidPhone(phone, preferredCurrency)) {
      setPhoneError(`Enter a valid ${preferredCurrency} mobile number, e.g. ${phonePlaceholder(preferredCurrency)}`)
      return
    }
    setPhoneError('')
    setError('')
    setStep('loading')
    try {
      const res = await fetch('/api/payments/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(depositRequestBody(parseFloat(amount), preferredCurrency, phone)),
      })
      const data = await readJson<{
        success?: boolean
        deposit_id?: string
        checkout_request_id?: string
        redirect_url?: string
        error?: string
      }>(res)
      if (res.ok && (data.success || data.deposit_id || data.checkout_request_id)) {
        // A redirect-based provider (e.g. PesaPal) hands back a hosted-payment
        // URL — send the user there rather than showing the STK screen.
        if (data.redirect_url) { window.location.href = data.redirect_url; return }
        setDepositId(data.deposit_id ?? null)
        setConfirm('waiting')
        setConfirmReason('')
        setStep('success')
      } else {
        // Never dead-end silently: surface the exact reason (min amount, bad
        // phone, gateway down, etc.) so the user knows what to fix.
        setError(data.error ?? 'We could not start the deposit. Check the amount and phone number, then try again.')
        setStep('form')
      }
    } catch {
      setError('Network error. Check your connection and try again.')
      setStep('form')
    }
  }

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-sheet animate-slide-up" role="dialog" aria-modal="true">
        {/* Handle */}
        <div className="w-10 h-1 bg-[var(--border)] rounded-full mx-auto mb-5" />

        {step === 'review' ? (
          /* The same read-back as WithdrawSheet: numerals AND words, and the
             number that is about to be charged. A mistyped deposit is far
             less costly than a mistyped withdrawal, but keeping the two flows
             identical in length is what Reg. 84 / 67(3) actually require. */
          <div className="py-2">
            <h3 className="font-display text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Check before you pay</h3>
            <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
              You will get an M-Pesa prompt on this number.
            </p>

            <dl className="rounded-lg border border-[var(--border)] divide-y divide-[color:var(--border)]">
              <div className="flex items-baseline justify-between gap-3 px-3 py-3">
                <dt className="text-sm" style={{ color: 'var(--text-secondary)' }}>Amount</dt>
                <dd className="text-[20px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  {curSymbol} {Math.floor(parseFloat(amount) || 0).toLocaleString()}
                </dd>
              </div>
              <div className="px-3 py-3">
                <dt className="text-sm mb-0.5" style={{ color: 'var(--text-secondary)' }}>In words</dt>
                <dd className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>
                  {amountInWords(parseFloat(amount) || 0, preferredCurrency)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 px-3 py-3">
                <dt className="text-sm" style={{ color: 'var(--text-secondary)' }}>From this number</dt>
                <dd className="text-[20px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{phone}</dd>
              </div>
            </dl>

            {error && (
              <p role="alert" aria-live="assertive" className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--red)_25%,transparent)] bg-[color-mix(in_srgb,var(--red)_10%,transparent)] px-3 py-2 text-sm text-[var(--red)]">
                {error}
              </p>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button className="btn btn-secondary btn-lg w-full" onClick={() => setStep('form')}>
                Change
              </button>
              <button className="btn btn-primary btn-lg w-full" onClick={submit}>
                Send prompt
              </button>
            </div>
          </div>
        ) : step === 'loading' ? (
          <StkPushLoader phase="sending" phone={phone} />
        ) : step === 'success' ? (
          <div className="text-center py-6">
            {confirm === 'credited' ? (
              resumeOrder ? (
                <>
                  <div className="w-16 h-16 rounded-full bg-[var(--green-dim)] flex items-center justify-center mx-auto mb-4">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <h3 className="font-display text-xl mb-2" style={{ color: 'var(--text-primary)' }}>Funds added</h3>
                  <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
                    Payment confirmed — placing your order…
                  </p>
                  <svg className="animate-spin mx-auto" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--pip-500)" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                </>
              ) : (
              <>
                <div className="w-16 h-16 rounded-full bg-[var(--green-dim)] flex items-center justify-center mx-auto mb-4">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <h3 className="font-display text-xl mb-2" style={{ color: 'var(--text-primary)' }}>Funds added</h3>
                <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
                  Your deposit is confirmed and your balance is updated. You&rsquo;re ready to trade.
                </p>
                <div className="flex flex-col gap-2">
                  <button className="btn btn-primary btn-lg w-full" onClick={() => { onClose(); router.push('/portfolio') }}>View portfolio</button>
                  <button className="btn btn-ghost w-full" onClick={onClose}>Done</button>
                </div>
              </>
              )
            ) : confirm === 'failed' ? (
              <>
                <div className="w-16 h-16 rounded-full bg-[color-mix(in_srgb,var(--red)_12%,transparent)] flex items-center justify-center mx-auto mb-4">
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </div>
                <h3 className="font-display text-xl mb-2" style={{ color: 'var(--text-primary)' }}>Deposit not completed</h3>
                <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>{confirmReason}</p>
                <div className="flex flex-col gap-2">
                  <button className="btn btn-primary btn-lg w-full" onClick={resetForm}>Try again</button>
                  <button className="btn btn-ghost w-full" onClick={onClose}>Close</button>
                </div>
              </>
            ) : (
              <>
                <StkPushLoader phase="waiting" phone={phone} timedOut={confirm === 'timeout'} />
                <div className="flex flex-col gap-2">
                  <button className="btn btn-primary btn-lg w-full" onClick={() => { onClose(); router.push('/portfolio') }}>View in portfolio</button>
                  <button className="btn btn-ghost w-full" onClick={onClose}>Done</button>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-display text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Deposit Funds</h3>
                <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>Instant via M-Pesa</p>
              </div>
              <button onClick={onClose} className="btn-ghost p-2 rounded-lg">
                <IconX size={18} className="text-[var(--text-muted)]" />
              </button>
            </div>

            {/* Quick amounts */}
            <div className="mb-4">
              <label htmlFor="amount-kes" className="text-xs font-semibold uppercase tracking-wide mb-2 block" style={{ color: 'var(--text-muted)' }}>Amount ({preferredCurrency})</label>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {presets.map(v => {
                  const val = String(v)
                  return (
                    <button
                      key={val}
                      onClick={() => setAmount(val)}
                      className={`py-2 rounded-lg text-sm font-semibold border transition-colors ${
                        amount === val
                          ? 'bg-[var(--pip-500)] text-white border-[var(--pip-500)]'
                          : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--pip-400)]'
                      }`}
                      style={{ background: amount === val ? undefined : 'var(--bg-tertiary)' }}
                    >
                      {v.toLocaleString()}
                    </button>
                  )
                })}
              </div>
              <input id="amount-kes"
                className="input input-lg"
                type="number"
                placeholder="Or enter amount…"
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
            </div>

            <div className="mb-5">
              <label htmlFor="phone-number" className="text-xs font-semibold uppercase tracking-wide mb-2 block" style={{ color: 'var(--text-muted)' }}>Phone Number</label>
              <input id="phone-number"
                className="input"
                type="tel"
                inputMode="tel"
                placeholder={phonePlaceholder(preferredCurrency)}
                aria-invalid={phoneError ? true : undefined}
                aria-describedby="phone-help"
                value={phone}
                onChange={e => { setPhone(e.target.value); if (phoneError) setPhoneError('') }}
              />
              <p id="phone-help" className={`mt-1.5 text-xs ${phoneError ? 'text-[var(--red)]' : ''}`} style={phoneError ? undefined : { color: 'var(--text-muted)' }} aria-live="polite">
                {phoneError || `The mobile-money number to charge · e.g. ${phonePlaceholder(preferredCurrency)}`}
              </p>
            </div>

            {error && (
              <p role="alert" aria-live="assertive" className="mb-3 rounded-lg border border-[color-mix(in_srgb,var(--red)_25%,transparent)] bg-[color-mix(in_srgb,var(--red)_10%,transparent)] px-3 py-2 text-sm text-[var(--red)]">
                {error}
              </p>
            )}
            <button
              className="btn btn-primary btn-lg w-full"
              onClick={review}
              disabled={!amount || !phone}
            >
              <IconDeposit size={16} />
              Review {amount && !isNaN(parseFloat(amount)) ? `${curSymbol} ${parseFloat(amount).toLocaleString()}` : 'deposit'}
            </button>

            <p className="text-center text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
              Secured by Safaricom encryption
            </p>
          </>
        )}
      </div>
    </div>
  )
}


// Inline withdraw (cash-out) sheet — mirrors DepositSheet. Closes the biggest
// dead-end in the money flow: users could fund but never cash out. Shows the
// available balance + a Max button, surfaces every rejection reason (min, KYC,
// insufficient, review hold) with a clear next step, and refreshes the wallet.
function WithdrawSheet({ onClose, balance, currency }: { onClose: () => void; balance: number; currency: CurrencyCode }) {
  const { refreshWallets } = useWallets()
  const router = useRouter()
  const [amount, setAmount] = useState('')
  // Prefilled with the dial code, like DepositSheet. Withdraw had neither the
  // prefill nor the validation its sibling has had all along.
  const [phone, setPhone] = useState(() => phonePrefill(currency))
  const [phoneError, setPhoneError] = useState('')
  // Numbers this account has proven it holds, by completing a deposit from
  // them (lib/payments/verified-phones). Offered as choices so the common
  // case is a tap rather than typing a number from memory — which is where
  // the mistyped digit comes from.
  const [knownPhones, setKnownPhones] = useState<string[]>([])
  // 'review' is the step this flow never had. Ruling E2: money left on the
  // strength of one tap against a free-text number, and 70% of Kenyan
  // mobile-money losses are accidental sends (FinAccess 2024, n=20,871).
  // Typed from the shared machine so deposit and withdraw stay equal (E5).
  const [step, setStep] = useState<FundingStep>('form')
  const [error, setError] = useState('')
  const [needsKyc, setNeedsKyc] = useState(false)
  const symbol = CURRENCIES[currency]?.symbol ?? ''
  const amt = parseFloat(amount) || 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let active = true
    fetch('/api/payments/verified-phones')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!active || !b?.phones?.length) return
        setKnownPhones(b.phones)
        // Prefill the most recent, but only while the field is untouched —
        // never overwrite something already typed.
        setPhone((cur) => (cur === phonePrefill(currency) || cur === '' ? b.phones[0] : cur))
      })
      .catch(() => {})
    return () => { active = false }
  }, [currency])

  // Form -> review. The server only checks the number is WELL-FORMED
  // (checkProviderDestination), not that it is yours, so a typo that happens
  // to be a valid Kenyan number is a real payment to a stranger. This is the
  // last point at which that is recoverable.
  const review = () => {
    if (!amount || !phone) return
    if (!isValidPhone(phone, currency)) {
      setPhoneError(`Enter a valid ${currency} mobile number, e.g. ${phonePlaceholder(currency)}`)
      return
    }
    setPhoneError(''); setError('')
    setStep('review')
  }

  const submit = async () => {
    if (!amount || !phone) return
    setError(''); setNeedsKyc(false); setStep('loading')
    try {
      const res = await fetch('/api/payments/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(withdrawRequestBody(amt, currency, phone)),
      })
      // Read defensively: an empty / non-JSON body (e.g. a session that lapsed
      // at the edge) must not crash the modal with "Unexpected end of JSON input".
      const data = await readJson<{
        success?: boolean
        withdrawal?: unknown
        withdrawal_id?: string
        kyc_required?: boolean
        error?: string
      }>(res)
      if (res.ok && (data.success || data.withdrawal || data.withdrawal_id)) {
        setStep('success')
        await refreshWallets()
      } else if (res.status === 401) {
        // Session lapsed — send them through auth-first, then back to withdraw.
        setStep('form')
        onClose()
        openAuthDialog({ reason: 'Sign in again to withdraw your funds' })
      } else {
        // Never dead-end: route to KYC when required, otherwise show the exact
        // reason (minimum, insufficient, suspended, provider) and let them fix it.
        if (data.kyc_required) setNeedsKyc(true)
        setError(data.error ?? 'We could not start the withdrawal. Check the amount and phone number, then try again.')
        setStep('form')
      }
    } catch {
      setError('Network error. Check your connection and try again.')
      setStep('form')
    }
  }

  return (
    <div className="modal-overlay" role="presentation" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet animate-slide-up" role="dialog" aria-modal="true">
        <div className="w-10 h-1 bg-[var(--border)] rounded-full mx-auto mb-5" />

        {step === 'review' ? (
          /* Read it back before it goes. Amount in numerals AND words, and the
             destination unmasked — this is the screen where a wrong digit is
             still free to fix, so nothing here is abbreviated or dimmed. */
          <div className="py-2">
            <h3 className="font-display text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Check before you send</h3>
            <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
              Money sent to the wrong number cannot be recovered.
            </p>

            <dl className="rounded-lg border border-[var(--border)] divide-y divide-[color:var(--border)]">
              <div className="flex items-baseline justify-between gap-3 px-3 py-3">
                <dt className="text-sm" style={{ color: 'var(--text-secondary)' }}>Amount</dt>
                <dd className="text-[20px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  {symbol}{Math.floor(amt).toLocaleString()} {currency}
                </dd>
              </div>
              <div className="px-3 py-3">
                <dt className="text-sm mb-0.5" style={{ color: 'var(--text-secondary)' }}>In words</dt>
                <dd className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>
                  {amountInWords(amt, currency)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 px-3 py-3">
                <dt className="text-sm" style={{ color: 'var(--text-secondary)' }}>To this number</dt>
                <dd className="text-[20px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{phone}</dd>
              </div>
            </dl>

            {error && (
              <div role="alert" aria-live="assertive" className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--red)_25%,transparent)] bg-[color-mix(in_srgb,var(--red)_10%,transparent)] px-3 py-2 text-sm text-[var(--red)]">
                {error}
              </div>
            )}

            {/* Equal weight, equal size ([32] rule 2): the way back must not be
                harder to find than the way on. */}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button className="btn btn-secondary btn-lg w-full" onClick={() => setStep('form')}>
                Change
              </button>
              <button className="btn btn-primary btn-lg w-full" onClick={submit}>
                Send
              </button>
            </div>
          </div>
        ) : step === 'loading' ? (
          <div className="py-10 text-center">
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Sending…</p>
          </div>
        ) : step === 'success' ? (
          <div className="text-center py-6">
            <div className="w-16 h-16 rounded-full bg-[var(--green-dim)] flex items-center justify-center mx-auto mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h3 className="font-display text-xl mb-2" style={{ color: 'var(--text-primary)' }}>Withdrawal requested</h3>
            <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
              We&rsquo;re sending <strong>{symbol}{amt.toLocaleString()} {currency}</strong> to <strong>{phone}</strong>. Large payouts may be held for a short review. Track it in your portfolio.
            </p>
            <button className="btn btn-primary btn-lg w-full" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="font-display text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Withdraw Funds</h3>
                <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>To M-Pesa</p>
              </div>
              <button onClick={onClose} className="btn-ghost p-2 rounded-lg" aria-label="Close">
                <IconX size={18} className="text-[var(--text-muted)]" />
              </button>
            </div>

            {/* Available balance + Max */}
            <div className="mb-4 flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Available</span>
              <span className="font-mono font-bold" style={{ color: 'var(--text-primary)' }}>{symbol}{balance.toLocaleString()} {currency}</span>
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="wd-amount" className="text-xs font-semibold uppercase tracking-wide block" style={{ color: 'var(--text-muted)' }}>Amount ({currency})</label>
                <button type="button" onClick={() => setAmount(String(Math.floor(balance)))} className="text-xs font-semibold text-[var(--pip-500)] hover:underline" disabled={balance <= 0}>
                  Max
                </button>
              </div>
              <input id="wd-amount" className="input input-lg" type="number" placeholder="Enter amount…" value={amount}
                onChange={e => setAmount(e.target.value)} />
            </div>

            <div className="mb-5">
              <label htmlFor="wd-phone" className="text-xs font-semibold uppercase tracking-wide mb-2 block" style={{ color: 'var(--text-muted)' }}>Phone Number</label>
              <input id="wd-phone" className="input" type="tel" placeholder={phonePlaceholder(currency)} value={phone}
                aria-invalid={phoneError ? true : undefined}
                aria-describedby={phoneError ? 'wd-phone-error' : undefined}
                onChange={e => { setPhone(e.target.value); if (phoneError) setPhoneError('') }} />
              {phoneError && (
                <p id="wd-phone-error" role="status" className="mt-1.5 text-sm font-medium text-[var(--red)]">{phoneError}</p>
              )}
              {knownPhones.length > 0 && (
                <div className="mt-2">
                  <p className="mb-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {knownPhones.length === 1 ? 'The number you deposit from' : 'Numbers you deposit from'}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {knownPhones.slice(0, 4).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => { setPhone(n); setPhoneError('') }}
                        aria-pressed={phoneKey(phone) === n}
                        className="min-h-11 rounded-pill border px-3 text-sm font-medium tabular-nums transition-colors"
                        style={{
                          borderColor: phoneKey(phone) === n ? 'var(--pip-500)' : 'var(--border)',
                          color: phoneKey(phone) === n ? 'var(--text-primary)' : 'var(--text-secondary)',
                        }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div role="alert" aria-live="assertive" className="mb-3 rounded-lg border border-[color-mix(in_srgb,var(--red)_25%,transparent)] bg-[color-mix(in_srgb,var(--red)_10%,transparent)] px-3 py-2 text-sm text-[var(--red)]">
                <p>{error}</p>
                {needsKyc && (
                  <button type="button" onClick={() => { onClose(); const back = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/portfolio'; router.push(`/kyc?next=${encodeURIComponent(back)}`) }} className="mt-1 font-semibold underline">
                    Verify your identity to continue
                  </button>
                )}
              </div>
            )}

            <button className="btn btn-primary btn-lg w-full" onClick={review}
              disabled={!amount || !phone || amt <= 0 || amt > balance}>
              {amt > balance ? 'Amount exceeds balance' : 'Review withdrawal'}
            </button>
            {balance <= 0 && (
              <p className="mt-3 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                No funds to withdraw yet.{' '}
                <button type="button" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('elopis:open-deposit')) }} className="font-semibold text-[var(--pip-500)] hover:underline">
                  Deposit first
                </button>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
