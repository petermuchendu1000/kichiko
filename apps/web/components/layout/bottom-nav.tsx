'use client'

// components/layout/bottom-nav.tsx
// ------------------------------------------------------------
// Mobile bottom navigation bar (Polymarket-parity): Home · Search · Breaking ·
// More. Fixed to the thumb zone on phones/tablets (lg:hidden) — the desktop
// experience keeps the top navbar + right-rail ticket instead.
//
//   - Home     -> "/"                     (landing / feed)
//   - Search   -> "/search"               (search surface)
//   - Breaking -> "/markets?sort=newest"  (freshest markets = "breaking")
//   - More     -> opens a bottom sheet of secondary destinations
//
// The market detail page also renders a sticky trade bar (mobile-trade-bar);
// that bar is offset to sit directly ABOVE this nav (see its `bottom` inline
// style) so the two never overlap.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/use-auth'
import { createClient } from '@/lib/supabase/client'
import {
  IconHome, IconSearch, IconFire, IconMenu, IconX,
  IconMarkets, IconTrophy, IconPortfolio, IconBell, IconUser,
  IconSettings, IconShield, IconLogOut, IconWallet,
} from '@/components/ui/icons'
import { ThemeToggle } from '@/components/ui/theme-toggle'

interface NavItem {
  key: string
  label: string
  icon: React.ReactNode
  href?: string
  match: (path: string) => boolean
}

export function BottomNav() {
  const pathname = usePathname() || '/'
  const router = useRouter()
  const { user } = useAuth()
  const [moreOpen, setMoreOpen] = useState(false)

  // Close the More sheet whenever we navigate.
  useEffect(() => {
    setMoreOpen(false)
  }, [pathname])

  const items: NavItem[] = [
    {
      key: 'home',
      label: 'Home',
      icon: <IconHome size={22} />,
      href: '/',
      match: (p) => p === '/',
    },
    {
      key: 'search',
      label: 'Search',
      icon: <IconSearch size={22} />,
      href: '/search',
      match: (p) => p.startsWith('/search'),
    },
    {
      key: 'breaking',
      label: 'Breaking',
      icon: <IconFire size={22} />,
      href: '/markets?sort=newest',
      match: (p) => p === '/markets' || p.startsWith('/markets?'),
    },
    {
      key: 'more',
      label: 'More',
      icon: <IconMenu size={22} />,
      match: () => moreOpen,
    },
  ]

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[color:var(--bg-secondary)] lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="mx-auto flex h-14 max-w-lg items-stretch">
          {items.map((item) => {
            const active = item.match(pathname)
            const content = (
              <span
                className={`flex h-full w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                  active
                    ? 'text-[var(--pip-text)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </span>
            )
            return (
              <li key={item.key} className="flex-1">
                {item.href ? (
                  <Link
                    href={item.href}
                    className="flex h-full w-full items-center justify-center"
                    aria-current={active ? 'page' : undefined}
                  >
                    {content}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => setMoreOpen((v) => !v)}
                    aria-haspopup="dialog"
                    aria-expanded={moreOpen}
                    className="flex h-full w-full items-center justify-center"
                  >
                    {content}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      {moreOpen && (
        <MoreSheet
          user={user}
          onClose={() => setMoreOpen(false)}
          onSignOut={async () => {
            const supabase = createClient()
            await supabase.auth.signOut()
            setMoreOpen(false)
            router.push('/')
            router.refresh()
          }}
        />
      )}
    </>
  )
}

function MoreSheet({
  user,
  onClose,
  onSignOut,
}: {
  user: ReturnType<typeof useAuth>['user']
  onClose: () => void
  onSignOut: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const links: { href: string; label: string; icon: React.ReactNode; auth?: boolean }[] = [
    { href: '/markets', label: 'Events', icon: <IconMarkets size={18} /> },
    { href: '/leaderboard', label: 'Leaderboard', icon: <IconTrophy size={18} /> },
    { href: '/portfolio', label: 'Portfolio', icon: <IconPortfolio size={18} />, auth: true },
    { href: '/notifications', label: 'Notifications', icon: <IconBell size={18} />, auth: true },
    { href: '/profile', label: 'Profile', icon: <IconUser size={18} />, auth: true },
    { href: '/kyc', label: 'Verify Identity', icon: <IconShield size={18} />, auth: true },
    { href: '/settings', label: 'Settings', icon: <IconSettings size={18} /> },
  ].filter((l) => !l.auth || !!user)

  return (
    <div
      className="modal-overlay lg:hidden"
      role="presentation"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal-sheet animate-slide-up" role="dialog" aria-modal="true" aria-label="More">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--border)]" />

        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            More
          </h3>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button onClick={onClose} className="btn-ghost rounded-lg p-2" aria-label="Close">
              <IconX size={18} className="text-[var(--text-muted)]" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-1">
          {/* Deposit — moved here from the removed top-nav mobile menu so cash-in
              stays one tap away on mobile. Opens the funding modal via the same
              global event the navbar listens for (handles the auth-first flow). */}
          {user && (
            <button
              type="button"
              onClick={() => { onClose(); window.dispatchEvent(new CustomEvent('kichiko:open-deposit')) }}
              className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            >
              <IconWallet size={18} />
              Deposit
            </button>
          )}
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={onClose}
              className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
            >
              {l.icon}
              {l.label}
            </Link>
          ))}
        </div>

        <div className="mt-3 border-t border-[var(--border)] pt-3">
          {user ? (
            <button
              onClick={onSignOut}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-[var(--red)] hover:bg-[var(--bg-tertiary)]"
            >
              <IconLogOut size={18} /> Sign out
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Link href="/auth/login" onClick={onClose} className="btn btn-ghost">
                Sign in
              </Link>
              <Link href="/auth/register" onClick={onClose} className="btn btn-primary">
                Get started
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
