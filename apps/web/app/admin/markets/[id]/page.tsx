// app/admin/markets/[id]/page.tsx — Market detail + lifecycle actions.
import { notFound } from 'next/navigation'
import { requirePageCapability } from '@/lib/admin/page-guard'
import { roleHasCapability } from '@/lib/admin/rbac'
import { availableMarketActions, type MarketStatus } from '@/lib/admin/markets'
import { usdToLocal } from '@/lib/currency'
import { MarketStatusBadge, OutcomeBadge } from '@/components/admin/markets/MarketBadges'
import { MarketActions, type AllowedAction } from '@/components/admin/markets/MarketActions'
import { PageHeader, Panel, PanelHead, PanelBody, Kpi, KpiGrid, Pill } from '@/components/admin/ui'
import { IconDollar, IconWallet, IconActivity, IconUsers } from '@/components/ui/icons'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Market detail' }

const money = (v: number | null | undefined) =>
  'KSh ' + Math.round(usdToLocal(Number(v ?? 0), 'KES')).toLocaleString('en-KE')
const dt = (v: string | null | undefined) => (v ? new Date(v).toLocaleString() : '—')

export default async function MarketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requirePageCapability(['markets:approve', 'markets:resolve', 'markets:cancel'])

  const { data: m, error } = await ctx.supabase
    .from('markets')
    .select(
      'id, slug, title, description, category, status, creator_id, creator_reward_rate, platform_fee_rate, opens_at, closes_at, resolves_at, resolved_at, resolver_id, resolution_criteria, resolution_source, resolution_notes, resolved_outcome, yes_price, no_price, liquidity_pool_usd, total_volume_usd, yes_volume_usd, no_volume_usd, total_bets, unique_bettors, is_featured, is_trending, featured_order, tags, created_at, creator:profiles!markets_creator_id_fkey(username, display_name)'
    )
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!m) notFound()

  const status = m.status as MarketStatus
  const creator = (m as { creator?: { username: string | null; display_name: string | null } | null }).creator
  const allowed: AllowedAction[] = availableMarketActions(status)
    .filter((a) => roleHasCapability(ctx.role, a.capability))
    .map((a) => ({ key: a.key, label: a.label, danger: a.danger }))

  const F = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="rounded-[10px] border bg-[var(--bg-secondary)]/40 px-3 py-2.5">
      <dt className="text-[0.7rem] uppercase tracking-wide text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-[var(--text-primary)]">{children}</dd>
    </div>
  )

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        crumbs={[{ label: 'Markets', href: '/admin/markets' }, { label: m.title ?? m.slug ?? id }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {m.title}
            <MarketStatusBadge status={status} />
          </span>
        }
        description={<span className="font-mono text-xs">/{m.slug} · by {creator?.username ?? creator?.display_name ?? m.creator_id}</span>}
        meta={
          <>
            {m.is_featured && <Pill tone="amber">Featured{m.featured_order != null ? ` · #${m.featured_order}` : ''}</Pill>}
            {m.is_trending && <Pill tone="red">Trending</Pill>}
          </>
        }
      />

      {/* Headline stats */}
      <KpiGrid className="mb-6">
        <Kpi label="Volume" value={money(m.total_volume_usd)} icon={<IconDollar size={18} />} sub={`${(m.total_bets ?? 0).toLocaleString()} bets`} />
        <Kpi label="Liquidity" value={money(m.liquidity_pool_usd)} icon={<IconWallet size={18} />} />
        <Kpi label="YES / NO" value={<span>{Number(m.yes_price ?? 0).toFixed(2)} <span className="text-[var(--text-muted)]">/</span> {Number(m.no_price ?? 0).toFixed(2)}</span>} icon={<IconActivity size={18} />} />
        <Kpi label="Unique bettors" value={(m.unique_bettors ?? 0).toLocaleString()} icon={<IconUsers size={18} />} />
      </KpiGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Details & criteria */}
          <Panel>
            <PanelHead title="Details" />
            <PanelBody className="space-y-3">
              <p className="whitespace-pre-wrap text-sm text-[var(--text-secondary)]">{m.description}</p>
              <div className="rounded-[10px] border bg-[var(--bg-secondary)] p-3 text-sm">
                <span className="font-semibold text-[var(--text-primary)]">Resolution criteria: </span>
                <span className="text-[var(--text-secondary)]">{m.resolution_criteria}</span>
              </div>
              {m.resolution_source && (
                <div className="rounded-[10px] border bg-[var(--bg-secondary)] p-3 text-sm">
                  <span className="font-semibold text-[var(--text-primary)]">Source: </span>
                  <span className="text-[var(--text-secondary)]">{m.resolution_source}</span>
                </div>
              )}
              {m.resolution_notes && (
                <div className="rounded-[10px] border bg-[var(--bg-secondary)] p-3 text-sm">
                  <span className="font-semibold text-[var(--text-primary)]">Resolution notes: </span>
                  <span className="text-[var(--text-secondary)]">{m.resolution_notes}</span>
                </div>
              )}
            </PanelBody>
          </Panel>

          {/* Market data grid */}
          <Panel>
            <PanelHead title="Market data" />
            <PanelBody>
              <dl className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <F label="Category"><span className="capitalize">{m.category ?? '—'}</span></F>
                <F label="Platform fee">{(Number(m.platform_fee_rate ?? 0) * 100).toFixed(2)}%</F>
                <F label="Creator reward">{(Number(m.creator_reward_rate ?? 0) * 100).toFixed(2)}%</F>
                <F label="Opens">{dt(m.opens_at)}</F>
                <F label="Closes">{dt(m.closes_at)}</F>
                <F label="Resolves">{dt(m.resolves_at)}</F>
                <F label="Resolved">{dt(m.resolved_at)}</F>
                <F label="Outcome"><OutcomeBadge outcome={m.resolved_outcome} /></F>
                <F label="Created">{dt(m.created_at)}</F>
              </dl>
            </PanelBody>
          </Panel>
        </div>

        {/* Actions */}
        <div className="space-y-6">
          <Panel>
            <PanelHead title="Lifecycle actions" description={`Available for a ${status} market`} />
            <PanelBody>
              {allowed.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No actions available for a {status} market with your permissions.</p>
              ) : (
                <MarketActions
                  marketId={m.id}
                  actions={allowed}
                  isFeatured={!!m.is_featured}
                  isTrending={!!m.is_trending}
                  featuredOrder={m.featured_order ?? null}
                />
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  )
}
