'use client'

// components/marketer/MarketerNav.tsx — tabbed nav for the marketer console.
// Client component so it can highlight the active route. Rendered as a real
// <nav> with an aria-current marker for accessibility; horizontally scrollable
// at 400px and inline on wider panels.
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS: { href: string; label: string }[] = [
  { href: '/marketer', label: 'Overview' },
  { href: '/marketer/referrals', label: 'Referrals' },
  { href: '/marketer/commissions', label: 'Commissions' },
  { href: '/marketer/campaigns', label: 'Campaigns' },
]

export function MarketerNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Marketer console" className="border-b border-[var(--border)]">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const active = t.href === '/marketer' ? pathname === '/marketer' : pathname.startsWith(t.href)
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={
                  'inline-block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ' +
                  (active
                    ? 'border-[var(--pip-500)] text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]')
                }
              >
                {t.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
