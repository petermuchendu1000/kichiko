// app/marketer/layout.tsx — Marketer self-service console shell.
//
// Server component: enforces console access (defence in depth atop RLS) once
// for the whole route group, then renders a lightweight, responsive, accessible
// tabbed shell. Marketers are affiliate/growth PARTNERS — this lives outside the
// staff /admin portal and only ever shows the caller's own RLS-scoped data.
import { requireMarketer } from '@/lib/marketer/guard'
import { MarketerNav } from '@/components/marketer/MarketerNav'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Marketer Console · Kichiko' }

export default async function MarketerLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireMarketer()
  const oversight = ctx.role !== 'marketer'

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 md:py-8">
      <div className="mb-6 flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-display text-[1.6rem] leading-tight text-[var(--text-primary)]">
            Marketer Console
          </h1>
          {oversight && (
            <span className="admin-pill text-amber-700 dark:text-amber-400 bg-amber-500/10 border-amber-500/20">
              Oversight ({ctx.role})
            </span>
          )}
        </div>
        <p className="max-w-2xl text-sm text-[var(--text-secondary)]">
          Track your referrals, commissions and campaigns. All amounts are shown in Kenyan
          Shillings at the current exchange rate.
        </p>
      </div>

      <MarketerNav />

      <main className="mt-6">{children}</main>
    </div>
  )
}
