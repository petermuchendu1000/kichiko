'use client'

// Profile — Pip system. Identity header + numeric KPI strip, recent positions
// history (links into the full Portfolio), wallets by currency, settings
// shortcuts, an inline-save edit form, and referral share. Notification
// delivery lives on /notifications (single source of truth) — linked, not
// duplicated here.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { formatUSD } from '@/lib/utils'
import { useAuth } from '@/hooks/use-auth'
import type { Position, Wallet, Market, CurrencyCode, KycStatus } from '@/types'
import { CURRENCIES } from '@/types'
import {
  IconMarkets,
  IconPercent,
  IconTrendUp,
  IconPortfolio,
  IconWallet,
  IconBell,
  IconShield,
  IconCalendar,
  IconShare,
  IconCheck,
  IconChevronRight,
  IconDeposit,
} from '@/components/ui/icons'

type PositionWithMarket = Position & { market: Pick<Market, 'id' | 'title' | 'slug'> | null }

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || 'A'
}

// Money renders as KES (KSh) via the canonical peg-aware formatter.
function fmtUsd(n: number, signed = false) {
  const v = n ?? 0
  const body = formatUSD(Math.abs(v))
  if (!signed) return body
  return `${v >= 0 ? '+' : '-'}${body}`
}

function KycBadge({ status }: { status: KycStatus }) {
  const map: Record<KycStatus, { cls: string; label: string }> = {
    verified: { cls: 'badge-green', label: 'Verified' },
    pending: { cls: 'badge-amber', label: 'KYC pending' },
    rejected: { cls: 'badge-red', label: 'KYC rejected' },
    unverified: { cls: 'badge-muted', label: 'Not verified' },
  }
  const { cls, label } = map[status] ?? map.unverified
  return (
    <span className={`badge gap-1.5 ${cls}`}>
      <IconShield size={12} />
      {label}
    </span>
  )
}

export function ProfileView() {
  const { user, profile, loading, refreshProfile } = useAuth()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [wallets, setWallets] = useState<Wallet[]>([])
  const [positions, setPositions] = useState<PositionWithMarket[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  const [form, setForm] = useState({
    display_name: '',
    username: '',
    bio: '',
    phone_number: '',
    preferred_currency: 'KES' as CurrencyCode,
  })

  useEffect(() => {
    if (!loading && !user) router.push('/auth/login')
  }, [user, loading, router])

  useEffect(() => {
    if (profile) {
      setForm({
        display_name: profile.display_name || '',
        username: profile.username || '',
        bio: profile.bio || '',
        phone_number: profile.phone_number || '',
        preferred_currency: profile.preferred_currency || 'KES',
      })
    }
  }, [profile])

  useEffect(() => {
    if (!user) return
    let active = true
    const load = async () => {
      const [{ data: wals }, { data: pos }] = await Promise.all([
        supabase.from('wallets').select('*').eq('user_id', user.id),
        supabase
          .from('positions')
          .select('*, market:markets(id, title, slug)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(8),
      ])
      if (!active) return
      setWallets((wals as Wallet[]) || [])
      setPositions((pos as PositionWithMarket[]) || [])
      setDataLoading(false)
    }
    load()
    return () => {
      active = false
    }
  }, [user, supabase])

  const handleSave = async () => {
    if (!user) return
    setSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({
        display_name: form.display_name,
        username: form.username || null,
        bio: form.bio,
        phone_number: form.phone_number || null,
        preferred_currency: form.preferred_currency,
      })
      .eq('id', user.id)
    setSaving(false)
    if (!error) {
      setSaved(true)
      await refreshProfile()
      setTimeout(() => setSaved(false), 2500)
    }
  }

  const copyReferral = () => {
    if (!profile?.referral_code) return
    navigator.clipboard.writeText(`${window.location.origin}?ref=${profile.referral_code}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading || !user || !profile) {
    return (
      <div className="animate-fade-in space-y-6">
        <div className="skeleton h-28 rounded-md" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-20 rounded-md" />
          ))}
        </div>
        <div className="skeleton h-64 rounded-md" />
      </div>
    )
  }

  const name = profile.display_name || profile.username || 'Trader'
  const kpis = [
    { label: 'Total bets', value: (profile.total_bets || 0).toLocaleString(), Icon: IconMarkets },
    { label: 'Win rate', value: `${Math.round((profile.win_rate || 0) * 100)}%`, Icon: IconPercent },
    { label: 'Volume', value: fmtUsd(profile.total_volume_usd || 0), Icon: IconTrendUp },
    {
      label: 'Profit & loss',
      value: fmtUsd(profile.profit_loss_usd || 0, true),
      Icon: IconPortfolio,
      color: (profile.profit_loss_usd || 0) >= 0 ? 'var(--yes-700)' : 'var(--no-700)',
    },
  ]

  return (
    <div className="animate-fade-in space-y-6">
      {/* Identity header */}
      <div className="card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt=""
              width={64}
              height={64}
              className="rounded-full object-cover"
              style={{ width: 64, height: 64, border: '1px solid var(--hairline)' }}
            />
          ) : (
            <span className="avatar" style={{ width: 64, height: 64, fontSize: 24 }} aria-hidden="true">
              {initials(name)}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl" style={{ color: 'var(--text-primary)' }}>
              {name}
            </h1>
            {profile.username && (
              <p className="truncate text-sm" style={{ color: 'var(--text-muted)' }}>
                @{profile.username}
              </p>
            )}
            <p className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              <IconCalendar size={12} />
              Joined {format(new Date(profile.created_at), 'MMMM yyyy')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <KycBadge status={profile.kyc_status} />
          {profile.kyc_status !== 'verified' && (
            <Link href="/kyc" className="btn btn-secondary btn-sm">
              Verify
            </Link>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="card flex items-center gap-3 p-4">
            <span className="stat-chip-icon" aria-hidden="true">
              <k.Icon size={17} />
            </span>
            <div className="min-w-0">
              <p className="mono truncate text-lg font-bold" style={{ color: k.color ?? 'var(--text-primary)' }}>
                {k.value}
              </p>
              <p className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                {k.label}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Body: positions + edit (left) · wallets + shortcuts + referral (right) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <PositionsHistory positions={positions} loading={dataLoading} />
          <EditForm form={form} setForm={setForm} onSave={handleSave} saving={saving} saved={saved} />
        </div>

        <div className="space-y-6">
          <WalletsCard wallets={wallets} loading={dataLoading} />
          <ShortcutsCard />
          {profile.referral_code && (
            <ReferralCard
              code={profile.referral_code}
              count={profile.referral_count || 0}
              copied={copied}
              onCopy={copyReferral}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
      {children}
    </h2>
  )
}

function PositionsHistory({ positions, loading }: { positions: PositionWithMarket[]; loading: boolean }) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <SectionTitle>Positions history</SectionTitle>
        <Link
          href="/portfolio"
          className="flex items-center gap-0.5 text-xs font-medium"
          style={{ color: 'var(--pip-text)' }}
        >
          Full portfolio <IconChevronRight size={13} />
        </Link>
      </div>
      <div className="card p-0">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-12 rounded-md" />
            ))}
          </div>
        ) : positions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-full"
              style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
            >
              <IconMarkets size={20} />
            </span>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              No positions yet
            </p>
            <Link href="/markets" className="btn btn-secondary btn-sm mt-1">
              Explore markets
            </Link>
          </div>
        ) : (
          <ul>
            {positions.map((p, i) => (
              <li key={p.id}>
                <Link
                  href={p.market ? `/markets/${p.market.slug}` : '#'}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-2)]"
                  style={{ borderTop: i === 0 ? 'none' : '1px solid var(--hairline)' }}
                >
                  <span className={`badge ${p.side === 'yes' ? 'badge-green' : 'badge-red'} shrink-0 uppercase`}>
                    {p.side}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {p.market?.title ?? 'Market'}
                  </span>
                  <span className="mono shrink-0 text-right text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span className="block" style={{ color: 'var(--text-2)' }}>
                      {p.shares.toLocaleString(undefined, { maximumFractionDigits: 1 })} sh
                    </span>
                    {fmtUsd(p.total_invested_usd)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function WalletsCard({ wallets, loading }: { wallets: Wallet[]; loading: boolean }) {
  return (
    <section>
      <SectionTitle>Wallets</SectionTitle>
      <div className="card p-4">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="skeleton h-10 rounded-md" />
            ))}
          </div>
        ) : wallets.length === 0 ? (
          <p className="py-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            No wallets yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {wallets.map((w) => {
              const info = CURRENCIES[w.currency]
              return (
                <li key={w.id} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2.5">
                    <span
                      className="mono flex h-8 w-8 items-center justify-center rounded-md text-xs font-semibold"
                      style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
                    >
                      {info?.symbol ?? w.currency}
                    </span>
                    <span>
                      <span className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {w.currency}
                      </span>
                      <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                        {info?.name ?? ''}
                      </span>
                    </span>
                  </span>
                  <span className="mono text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {info?.symbol ?? ''}
                    {w.available_balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

function ShortcutsCard() {
  const items = [
    { href: '/portfolio', label: 'Portfolio', hint: 'Holdings & live P&L', Icon: IconWallet },
    { href: '/notifications', label: 'Notifications', hint: 'Feed & delivery preferences', Icon: IconBell },
    { href: '/kyc', label: 'Verification', hint: 'Identity & limits', Icon: IconShield },
    { href: '/markets', label: 'Deposit & trade', hint: 'Fund and open positions', Icon: IconDeposit },
  ]
  return (
    <section>
      <SectionTitle>Settings & shortcuts</SectionTitle>
      <div className="card p-0">
        <ul>
          {items.map((it, i) => (
            <li key={it.href}>
              <Link
                href={it.href}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-2)]"
                style={{ borderTop: i === 0 ? 'none' : '1px solid var(--hairline)' }}
              >
                <span className="stat-chip-icon" aria-hidden="true">
                  <it.Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {it.label}
                  </span>
                  <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                    {it.hint}
                  </span>
                </span>
                <IconChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function ReferralCard({
  code,
  count,
  copied,
  onCopy,
}: {
  code: string
  count: number
  copied: boolean
  onCopy: () => void
}) {
  return (
    <section>
      <SectionTitle>Refer a friend</SectionTitle>
      <div className="card p-4">
        <p className="mb-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          Share your code — you both earn a bonus when they join and trade.
        </p>
        <div className="flex gap-2">
          <input className="input mono flex-1 text-sm" readOnly value={code} aria-label="Referral code" />
          <button className="btn btn-secondary btn-sm shrink-0 gap-1.5" onClick={onCopy}>
            {copied ? <IconCheck size={14} /> : <IconShare size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          <span className="mono font-semibold" style={{ color: 'var(--text-2)' }}>
            {count}
          </span>{' '}
          referral{count === 1 ? '' : 's'} so far
        </p>
      </div>
    </section>
  )
}

function EditForm({
  form,
  setForm,
  onSave,
  saving,
  saved,
}: {
  form: { display_name: string; username: string; bio: string; phone_number: string; preferred_currency: CurrencyCode }
  setForm: React.Dispatch<React.SetStateAction<typeof form>>
  onSave: () => void
  saving: boolean
  saved: boolean
}) {
  return (
    <section>
      <SectionTitle>Edit profile</SectionTitle>
      <div className="card space-y-4 p-5">
        <Field label="Display name" htmlFor="display_name">
          <input
            id="display_name"
            className="input"
            value={form.display_name}
            onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
          />
        </Field>
        <Field label="Username" htmlFor="username">
          <input
            id="username"
            className="input"
            placeholder="username"
            value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.replace(/^@/, '') }))}
          />
        </Field>
        <Field label="Bio" htmlFor="bio">
          <textarea
            id="bio"
            className="input"
            rows={3}
            style={{ resize: 'vertical' }}
            value={form.bio}
            onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Phone number" htmlFor="phone_number">
            <input
              id="phone_number"
              type="tel"
              className="input"
              placeholder="+254700000000"
              value={form.phone_number}
              onChange={(e) => setForm((f) => ({ ...f, phone_number: e.target.value }))}
            />
          </Field>
          <Field label="Preferred currency" htmlFor="preferred_currency">
            <select
              id="preferred_currency"
              className="input cursor-pointer"
              value={form.preferred_currency}
              onChange={(e) => setForm((f) => ({ ...f, preferred_currency: e.target.value as CurrencyCode }))}
            >
              {Object.values(CURRENCIES).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button className="btn btn-primary" onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <span aria-live="polite" className="text-sm" style={{ color: 'var(--yes-700)' }}>
            {saved && (
              <span className="inline-flex items-center gap-1">
                <IconCheck size={14} /> Saved
              </span>
            )}
          </span>
        </div>
      </div>
    </section>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-2)' }}>
        {label}
      </label>
      {children}
    </div>
  )
}
