// app/creator/layout.tsx — Self-service creator console shell.
//
// Server component: enforces creator access (defence in depth atop RLS) and
// renders the console masthead + section nav. A creator authors prediction
// markets and tracks the reward volume they earn; this console is user-facing
// (NOT the /admin staff control plane).
import { requireCreator } from '@/lib/creator/guard'
import { CreatorNav } from '@/components/creator/CreatorNav'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Creator Console · Kichiko',
  robots: { index: false, follow: false },
}

export default async function CreatorLayout({ children }: { children: React.ReactNode }) {
  // Redirects non-creators before any child renders.
  await requireCreator()

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:py-8">
      <div className="mb-4">
        <h1 className="font-display text-2xl text-[var(--text-primary)]">Creator Console</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--text-secondary)]">
          Author prediction markets and track the reward volume they earn.
        </p>
      </div>
      <div className="mb-6">
        <CreatorNav />
      </div>
      <main>{children}</main>
    </div>
  )
}
