'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'
import { useWallets } from '@/hooks/use-wallets'
import { createClient } from '@/lib/supabase/client'
import { CURRENCIES, type CurrencyCode } from '@/types'
import { depositPresets, phonePlaceholder, phonePrefill, normalizePhone, isValidPhone } from '@/lib/payments/deposit-ux'
import { readJson } from '@/lib/http/client'
import { openAuthDialog } from '@/components/auth/auth-dialog'
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
  const { wallets, preferredCurrency } = useWallets()
  const supabase = createClient()

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
    window.addEventListener('kichiko:open-deposit', openDeposit)
    return () => window.removeEventListener('kichiko:open-deposit', openDeposit)
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
    window.addEventListener('kichiko:open-withdraw', openWithdraw)
    return () => window.removeEventListener('kichiko:open-withdraw', openWithdraw)
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
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  const navLinks = [
    { href: '/markets', label: 'Events', icon: <IconMarkets size={15}/> },
    { href: '/leaderboard', label: 'Leaders', icon: <IconTrophy size={15}/> },
  ]

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

  return (
    <>
      <nav className={`navbar transition-shadow ${scrolled ? 'shadow-lg' : ''}`}>
        <div className="max-w-[1350px] mx-auto px-4 lg:px-6 h-14 flex items-center gap-3">

          {/* Logo + company name — the name now sits next to the mark on every
              breakpoint (previously hidden on the smallest screens). */}
          <Link href="/" className="flex items-center gap-2 mr-1 sm:mr-2 flex-shrink-0" aria-label="Kichiko home">
            <LogoMark size={28} />
            <span className="font-display text-[15px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>
              Kichiko
            </span>
          </Link>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all ${
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
                            {/* Marketer console is a user-facing elevated-role destination. The
                                app-level UserRole type is narrower than the DB user_role enum, so
                                we compare via a string allow-list rather than the enum literal. */}
                            {(['marketer', 'admin', 'superadmin'] as string[]).includes(profile?.role ?? '') && (
                              <Link href="/marketer" className="dropdown-item" onClick={() => setUserMenuOpen(false)}>
                                <IconTrophy size={15} /><span>Marketer Console</span>
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
  const [step, setStep] = useState<'form' | 'loading' | 'success'>('form')
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
    window.dispatchEvent(new CustomEvent('kichiko:deposit-credited'))
    const t = setTimeout(() => onClose(), 1400)
    return () => clearTimeout(t)
  }, [confirm, resumeOrder, onClose])

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
        body: JSON.stringify({ amount: parseFloat(amount), currency: preferredCurrency, phone_number: normalizePhone(phone, preferredCurrency), provider: 'mpesa' }),
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

        {step === 'loading' ? (
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
                <div className="w-16 h-16 rounded-full bg-[var(--red)]/12 flex items-center justify-center mx-auto mb-4">
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
                      className={`py-2 rounded-lg text-sm font-semibold border transition-all ${
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
              <p role="alert" aria-live="assertive" className="mb-3 rounded-lg border border-[var(--red)]/25 bg-[var(--red)]/10 px-3 py-2 text-sm text-[var(--red)]">
                {error}
              </p>
            )}
            <button
              className="btn btn-primary btn-lg w-full"
              onClick={submit}
              disabled={!amount || !phone}
            >
              <IconDeposit size={16} />
              Pay {amount && !isNaN(parseFloat(amount)) ? `${curSymbol} ${parseFloat(amount).toLocaleString()}` : 'Now'}
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
  const [phone, setPhone] = useState('')
  const [step, setStep] = useState<'form' | 'loading' | 'success'>('form')
  const [error, setError] = useState('')
  const [needsKyc, setNeedsKyc] = useState(false)
  const symbol = CURRENCIES[currency]?.symbol ?? ''
  const amt = parseFloat(amount) || 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async () => {
    if (!amount || !phone) return
    setError(''); setNeedsKyc(false); setStep('loading')
    try {
      const res = await fetch('/api/payments/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amt, currency, phone_number: phone, provider: 'mpesa' }),
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

        {step === 'success' ? (
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
              <input id="wd-phone" className="input" type="tel" placeholder="+254 700 000 000" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>

            {error && (
              <div role="alert" aria-live="assertive" className="mb-3 rounded-lg border border-[var(--red)]/25 bg-[var(--red)]/10 px-3 py-2 text-sm text-[var(--red)]">
                <p>{error}</p>
                {needsKyc && (
                  <button type="button" onClick={() => { onClose(); const back = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/portfolio'; router.push(`/kyc?next=${encodeURIComponent(back)}`) }} className="mt-1 font-semibold underline">
                    Verify your identity to continue
                  </button>
                )}
              </div>
            )}

            <button className="btn btn-primary btn-lg w-full" onClick={submit}
              disabled={step === 'loading' || !amount || !phone || amt <= 0 || amt > balance}>
              {step === 'loading' ? 'Processing…' : amt > balance ? 'Amount exceeds balance' : 'Withdraw'}
            </button>
            {balance <= 0 && (
              <p className="mt-3 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                No funds to withdraw yet.{' '}
                <button type="button" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('kichiko:open-deposit')) }} className="font-semibold text-[var(--pip-500)] hover:underline">
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
