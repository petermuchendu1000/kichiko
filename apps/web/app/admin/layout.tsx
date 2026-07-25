// app/admin/layout.tsx — Admin control-plane shell.
//
// Server component: resolves the operator, enforces portal access (defence in
// depth atop middleware + RLS), and renders the capability-filtered nav so each
// operator only sees the sections they can use. superadmin sees everything.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getAuthContext } from '@/lib/auth'
import { canAccessAdminPortal, isSuperadmin } from '@/lib/admin/rbac'
import { visibleNav } from '@/lib/admin/nav'
import { AdminNav } from '@/components/admin/AdminNav'
import { IconExternalLink } from '@/components/ui/icons'

export const dynamic = 'force-dynamic'

const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  moderator: 'Moderator',
  finance: 'Finance',
  support: 'Support',
  resolver: 'Resolver',
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getAuthContext()
  if (!ctx) redirect('/auth/login?next=/admin')
  if (!canAccessAdminPortal(ctx.role)) redirect('/')

  const groups = visibleNav(ctx.role)
  const superadmin = isSuperadmin(ctx.role)

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="flex flex-col md:flex-row">
        <AdminNav groups={groups} />

        <div className="min-w-0 flex-1">
          {/* Top bar */}
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b bg-[var(--surface)]/85 px-4 backdrop-blur md:px-8">
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              <span className="hidden items-center gap-1.5 sm:flex">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden />
                Operational
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="hidden items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] sm:flex"
              >
                View site <IconExternalLink size={13} />
              </Link>
              <span
                className={
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ' +
                  (superadmin
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400')
                }
                title={superadmin ? 'Superadmin: holds every capability' : undefined}
              >
                {superadmin && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M5 18h14l1-9-4.5 3L12 5 8.5 12 4 9z" />
                  </svg>
                )}
                {ROLE_LABEL[ctx.role] ?? ctx.role}
              </span>
            </div>
          </header>

          <main className="p-4 md:p-8">{children}</main>
        </div>
      </div>
    </div>
  )
}
