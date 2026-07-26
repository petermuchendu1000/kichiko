// app/traders/[id]/page.tsx — public trader profile (Board→Peek→Profile).
// Server-rendered for SEO + fast first paint; the P&L card and portfolio table
// are the only client islands. Reads the read-only trader_public_profile RPC
// (public aggregates only — no PII). Emits ProfilePage JSON-LD + canonical.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { formatVolume } from '@/lib/utils'
import { traderName as resolveName, joinedMonthYear } from '@/lib/trader'
import { TraderAvatar } from '@/components/ui/trader-avatar'
import { tierForVolume } from '@/lib/tier'
import { TraderPnlCard } from '@/components/profile/trader-pnl-card'
import { TraderPortfolio } from '@/components/profile/trader-portfolio'
import { ProfileViewPing } from '@/components/profile/profile-view-ping'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface TraderProfile {
  user_id: string
  display_name: string | null
  username: string | null
  avatar_url: string | null
  bio: string | null
  joined_at: string | null
  view_count: number
  positions_value: number
  biggest_win_usd: number
  predictions: number
  profit_loss_usd: number
  volume_usd: number
  win_rate: number
}

async function getTrader(id: string): Promise<TraderProfile | null> {
  if (!UUID_RE.test(id)) return null
  const supabase = await createClient()
  const { data } = await supabase.rpc('trader_public_profile' as never, { p_user_id: id } as never)
  return ((data as unknown) as TraderProfile[] | null)?.[0] ?? null
}

function traderName(t: TraderProfile): string {
  return resolveName(t, t.user_id)
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const t = await getTrader(id)
  if (!t) return { title: 'Player not found' }
  const name = traderName(t)
  return {
    title: `${name}: Player profile`,
    description: `${name}'s prediction-market track record on Kichiko: positions, profit & loss, and trading activity.`,
    alternates: { canonical: `/traders/${id}` },
    openGraph: { title: `${name} on Kichiko`, type: 'profile' },
    robots: { index: true, follow: true },
  }
}

// PM-parity stat: value 18px/28px weight 500, label 12px/16px weight 500 ink-500.
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[18px] font-medium leading-[28px] tabular-nums text-text-primary">{value}</p>
      <p className="text-xs font-medium text-text-muted">{label}</p>
    </div>
  )
}

export default async function TraderProfilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const t = await getTrader(id)
  if (!t) notFound()

  const name = traderName(t)
  const joined = joinedMonthYear(t.joined_at)
  const tier = tierForVolume(Number(t.volume_usd))
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: {
      '@type': 'Person',
      name,
      identifier: t.user_id,
      ...(t.username ? { alternateName: `@${t.username}` } : {}),
      ...(t.bio ? { description: t.bio } : {}),
    },
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <ProfileViewPing userId={t.user_id} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Identity + P&L — mirrored two-up like the reference. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Identity card */}
        <div className="card p-5">
          <div className="flex items-start gap-4">
            <TraderAvatar id={t.user_id} name={name} imageUrl={t.avatar_url} size={64} verified={!!t.username} tier={tier.key} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate font-display text-2xl text-text-primary">{name}</h1>
                {t.username && (
                  <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-xs font-medium text-text-secondary">
                    @{t.username}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-sm text-text-muted">
                {joined && `Joined ${joined}`}
                {t.view_count > 0 && ` · ${t.view_count.toLocaleString()} views`}
              </p>
              {t.bio && <p className="mt-2 line-clamp-2 text-sm text-text-secondary">{t.bio}</p>}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-hairline pt-4">
            <Stat label="Value held" value={formatVolume(t.positions_value)} />
            {/* Compact like PM ($218.5K) so three stats fit a 390px row without overlap. */}
            <Stat label="Biggest win" value={t.biggest_win_usd > 0 ? formatVolume(t.biggest_win_usd) : '-'} />
            <Stat label="Predictions" value={Number(t.predictions).toLocaleString()} />
          </div>
        </div>

        {/* P&L card */}
        <TraderPnlCard userId={t.user_id} profitLoss={Number(t.profit_loss_usd)} userName={name} profileUrl={`/traders/${t.user_id}`} />
      </div>

      {/* Portfolio */}
      <div className="mt-6">
        <TraderPortfolio userId={t.user_id} />
      </div>
    </div>
  )
}
