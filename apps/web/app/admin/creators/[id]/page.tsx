// app/admin/creators/[id]/page.tsx — Creator detail: profile, tier, stats, controls.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { fetchCreatorStats, effectiveRewardPct, effectiveMaxOpenMarkets, formatRewardPct } from '@/lib/admin/creators'
import { ProfileStatusBadge, TierBadge } from '@/components/admin/growth/Badges'
import { CreatorStatusActions, CreatorEditForm } from '@/components/admin/growth/CreatorActions'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Creator' }

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-black tabular-nums">{value}</div>
    </div>
  )
}

export default async function CreatorDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requirePageCapability('creators:manage')
  const sb = ctx.supabase

  const { data: creator } = await sb
    .from('creator_profiles')
    .select('user_id, tier, reward_pct, auto_publish, max_open_markets, status, suspended_reason, created_at, profiles!creator_profiles_user_id_fkey(username, display_name, country_code)')
    .eq('user_id', id)
    .single()
  if (!creator) notFound()

  const [{ data: tier }, { data: tiers }, stats] = await Promise.all([
    sb.from('creator_tiers').select('key, reward_pct, max_open_markets, auto_publish').eq('key', creator.tier).single(),
    sb.from('creator_tiers').select('key, is_active').order('sort_order'),
    fetchCreatorStats(sb, id),
  ])

  const p = creator.profiles as unknown as { username: string | null; display_name: string | null; country_code: string | null } | null
  const tierKeys = (tiers ?? []).filter((t) => t.is_active).map((t) => t.key)
  const effReward = effectiveRewardPct(creator, tier ?? null)
  const effMax = effectiveMaxOpenMarkets(creator, tier ?? null)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/creators" className="text-sm text-muted-foreground hover:underline">← Creators</Link>
        <h1 className="text-2xl font-black">{p?.username ?? id.slice(0, 8)}</h1>
        <TierBadge tier={creator.tier} />
        <ProfileStatusBadge status={creator.status} />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <span>{p?.display_name}</span>
        {p?.country_code && <span>· {p.country_code}</span>}
        <span>· Approved {new Date(creator.created_at).toLocaleDateString()}</span>
        <Link href={`/admin/users/${id}`} className="text-primary hover:underline">View user →</Link>
      </div>
      {creator.suspended_reason && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
          {creator.status}: {creator.suspended_reason}
        </div>
      )}

      <div className="card-grid grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Markets authored" value={stats.marketsAuthored.toLocaleString()} />
        <Stat label="Open markets" value={`${stats.openMarkets} / ${effMax}`} />
        <Stat label="Effective reward" value={formatRewardPct(effReward)} />
        <Stat label="Lifetime reward" value={`$${stats.lifetimeRewardUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
      </div>

      <div className="flex items-center justify-end">
        <CreatorStatusActions userId={id} status={creator.status} />
      </div>

      <CreatorEditForm
        userId={id}
        tiers={tierKeys}
        current={{ tier: creator.tier, auto_publish: creator.auto_publish, reward_pct: creator.reward_pct != null ? Number(creator.reward_pct) : null, max_open_markets: creator.max_open_markets != null ? Number(creator.max_open_markets) : null }}
      />

      <p className="text-xs text-muted-foreground">
        Note: creator rewards are credited to the wallet instantly when bets are placed. Payout runs for creators
        are statements over these already-credited rewards — see Payout Runs.
      </p>
    </div>
  )
}
