'use client'

// components/admin/AdminNav.tsx — control-plane sidebar.
// Uses the bespoke Kichiko icon language (zero external icon libraries) to
// stay consistent with the rest of the product.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  IconGrid, IconUsers, IconPen, IconMegaphone, IconShield, IconMarkets,
  IconFlag, IconWallet, IconCoins, IconSettings, IconBanknote, IconPlug,
  IconBell, IconKey, IconScroll, IconMenu, IconX,
} from '@/components/ui/icons'
import type { AdminNavGroup } from '@/lib/admin/nav'

type IconCmp = (p: { size?: number; className?: string }) => React.ReactElement

const ICONS: Record<string, IconCmp> = {
  LayoutDashboard: IconGrid,
  Users: IconUsers,
  PenSquare: IconPen,
  Megaphone: IconMegaphone,
  ShieldCheck: IconShield,
  BarChart3: IconMarkets,
  Flag: IconFlag,
  Wallet: IconWallet,
  Coins: IconCoins,
  Settings: IconSettings,
  Banknote: IconBanknote,
  Plug: IconPlug,
  Bell: IconBell,
  KeyRound: IconKey,
  ScrollText: IconScroll,
}

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href
  return pathname === href || pathname.startsWith(href + '/')
}

function BrandMark() {
  return (
    <Link href="/admin" className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--text-primary)] text-[var(--bg)]">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 15l4.5-5 3.5 3.5L20 6" />
          <path d="M15 6h5v5" />
        </svg>
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-display text-[0.95rem] text-[var(--text-primary)]">Kichiko</span>
        <span className="mt-0.5 text-[0.62rem] font-medium uppercase tracking-[0.18em] text-[var(--text-muted)]">Control Plane</span>
      </span>
    </Link>
  )
}

function NavList({
  groups,
  pathname,
  onNavigate,
}: {
  groups: AdminNavGroup[]
  pathname: string
  onNavigate?: () => void
}) {
  return (
    <nav className="flex flex-col gap-5 px-3 py-4" aria-label="Admin navigation">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-2.5 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
            {group.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const Icon = ICONS[item.icon] ?? IconGrid
              const active = isActive(pathname, item.href, item.exact)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    data-active={active}
                    className="admin-nav-link"
                  >
                    <Icon size={17} className="admin-nav-icon" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

export function AdminNav({ groups }: { groups: AdminNavGroup[] }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  // A11y: close the mobile drawer on Escape and whenever the route changes, so
  // keyboard users aren't trapped and the menu never lingers after navigation.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex items-center justify-between border-b bg-[var(--surface)] px-4 py-3 md:hidden">
        <BrandMark />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          className="btn btn-secondary btn-sm !px-2"
        >
          {open ? <IconX size={18} /> : <IconMenu size={18} />}
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="border-b bg-[var(--surface)] md:hidden">
          <NavList groups={groups} pathname={pathname} onNavigate={() => setOpen(false)} />
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden w-[15.5rem] shrink-0 border-r bg-[var(--surface)] md:block">
        <div className="sticky top-0 flex max-h-screen flex-col overflow-y-auto scrollbar-hide">
          <div className="border-b px-5 py-4">
            <BrandMark />
          </div>
          <NavList groups={groups} pathname={pathname} />
        </div>
      </aside>
    </>
  )
}
