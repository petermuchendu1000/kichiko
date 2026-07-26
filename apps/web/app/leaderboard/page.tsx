// /leaderboard — ranked traders (volume / win rate / P&L) with a restrained
// top-3 podium and a monospaced standings table. Pip system, no emoji, no
// DaisyUI. Data comes from GET /api/leaderboard (client island below).
import type { Metadata } from 'next'
import { LeaderboardView } from '@/components/leaderboard/leaderboard-view'
import { IconLeaderboard } from '@/components/ui/icons'

export const metadata: Metadata = {
  title: 'Leaderboard',
  description:
    'The top players on Kichiko, ranked by how much they have traded, their win rate, and profit or loss (all-time, this month and this week).',
  alternates: { canonical: '/leaderboard' },
}

export default function LeaderboardPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-start gap-3">
        <span
          className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
          style={{ background: 'var(--pip-100)', color: 'var(--pip-text)' }}
          aria-hidden="true"
        >
          <IconLeaderboard size={20} />
        </span>
        <div>
          <h1 className="font-display text-2xl" style={{ color: 'var(--text-primary)' }}>
            Leaderboard
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--text-muted)' }}>
            The sharpest traders on Kichiko, ranked by the numbers.
          </p>
        </div>
      </header>

      <LeaderboardView />
    </div>
  )
}
