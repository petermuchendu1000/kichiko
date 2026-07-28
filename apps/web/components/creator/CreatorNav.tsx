'use client'

// components/creator/CreatorNav.tsx — tab nav for the self-service creator console.
// Client component so the active section is highlighted via usePathname. Uses
// semantic <nav> + aria-current for accessibility (axe/Lighthouse gates).
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS: { href: string; label: string }[] = [
  { href: '/creator', label: 'Overview' },
  { href: '/creator/markets', label: 'Markets' },
  { href: '/creator/earnings', label: 'Earnings' },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/creator') return pathname === '/creator'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function CreatorNav() {
  const pathname = usePathname() || '/creator'
  return (
    <nav aria-label="Creator console" className="border-b border-[var(--border)]">
      <ul className="-mb-px flex flex-wrap gap-1">
        {LINKS.map((l) => {
          const active = isActive(pathname, l.href)
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={
                  'inline-flex items-center border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ' +
                  (active
                    ? 'border-[var(--pip-500)] text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-secondary)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]')
                }
              >
                {l.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
