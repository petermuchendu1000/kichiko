// /leaderboard — paused. The profit/volume/win-rate ranking was removed (work plan
// v2, docs/research/ui-2026-09/41-WORK-PLAN-V2.md §6.3): ranking people by
// winnings is a winner feed (rules DP-3/DP-4), and Kenya's L.N. 112 Reg. 87 keeps
// winners' identities confidential without written consent. It returns as an
// opt-in accuracy board once markets have resolved and there is something to
// score. The route stays so old links land on an explanation instead of a 404.
import type { Metadata } from 'next'
import Link from 'next/link'
import { IconLeaderboard } from '@/components/ui/icons'

export const metadata: Metadata = {
  title: 'Leaderboard',
  description: 'The Kichiko leaderboard is paused while it is rebuilt as an opt-in accuracy board.',
  robots: { index: false, follow: true },
}

export default function LeaderboardPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-12">
      <span
        className="flex h-10 w-10 items-center justify-center rounded-md"
        style={{ background: 'var(--pip-100)', color: 'var(--pip-text)' }}
        aria-hidden="true"
      >
        <IconLeaderboard size={20} />
      </span>
      <h1 className="font-display text-2xl text-text-primary">The leaderboard is paused</h1>
      <p className="text-text-secondary">
        We no longer rank people by how much they have won. The leaderboard will come back as an
        opt-in board that scores how accurate forecasts were, once markets have resolved.
      </p>
      <div>
        <Link href="/markets" className="btn btn-primary min-h-11">
          Browse events
        </Link>
      </div>
    </div>
  )
}
