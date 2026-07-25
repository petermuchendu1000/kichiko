// app/admin/markets/page.tsx — Market review queue: filter / sort / paginate.
import Link from 'next/link'
import { requirePageCapability } from '@/lib/admin/page-guard'
import {
  parseMarketListParams,
  fetchMarkets,
  MARKET_SORTS,
  type MarketListParams,
} from '@/lib/admin/markets'
import { MarketStatusBadge, OutcomeBadge } from '@/components/admin/markets/MarketBadges'
import { usdToLocal } from '@/lib/currency'
import {
  PageHeader, FilterBar, SearchField, SelectField, ApplyButton,
  TableCard, Table, Th, Td, Pagination, EmptyRow, Pill,
} from '@/components/admin/ui'
import { IconGavel, IconMarkets, IconFire, IconStar } from '@/components/ui/icons'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Admin · Events' }

const STATUS_OPTIONS = ['', 'draft', 'pending', 'active', 'closed', 'resolved', 'disputed', 'cancelled']
const CATEGORY_OPTIONS = ['', 'politics', 'sports', 'crypto', 'economics', 'entertainment', 'technology', 'weather', 'other']
type SortKey = MarketListParams['sort']

function qs(params: MarketListParams, overrides: Partial<MarketListParams>): string {
  const merged = { ...params, ...overrides }
  const sp = new URLSearchParams()
  if (merged.q) sp.set('q', merged.q)
  if (merged.status) sp.set('status', merged.status)
  if (merged.category) sp.set('category', merged.category)
  if (merged.featured !== null) sp.set('featured', String(merged.featured))
  sp.set('sort', merged.sort)
  sp.set('dir', merged.dir)
  sp.set('page', String(merged.page))
  sp.set('pageSize', String(merged.pageSize))
  return sp.toString()
}

const money = (v: number | null) =>
  'KSh ' + Math.round(usdToLocal(Number(v ?? 0), 'KES')).toLocaleString('en-KE')
const opt = (values: string[], any: string) => values.map((v) => ({ value: v, label: v === '' ? any : v }))

export default async function MarketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requirePageCapability(['markets:approve', 'markets:resolve', 'markets:cancel'])
  const params = parseMarketListParams(await searchParams)
  const { rows, total } = await fetchMarkets(ctx.supabase, params)

  const sortHref = (col: SortKey) => {
    const dir = params.sort === col && params.dir === 'desc' ? 'asc' : 'desc'
    return `/admin/markets?${qs(params, { sort: col, dir, page: 1 })}`
  }

  return (
    <div>
      <PageHeader
        title="Events"
        description="Approve, resolve, feature and moderate every event on the platform."
        meta={<span>{total.toLocaleString()} markets</span>}
        actions={
          <Link href="/admin/markets/disputes" className="btn btn-secondary btn-sm gap-1.5">
            <IconGavel size={15} /> Dispute queue
          </Link>
        }
      />

      <FilterBar>
        <SearchField id="q" name="q" defaultValue={params.q ?? ''} placeholder="Search title or slug…" />
        <SelectField id="status" name="status" label="Status" options={opt(STATUS_OPTIONS, 'Any status')} defaultValue={params.status ?? ''} />
        <SelectField id="category" name="category" label="Category" options={opt(CATEGORY_OPTIONS, 'Any category')} defaultValue={params.category ?? ''} />
        <SelectField id="sort" name="sort" label="Sort" options={MARKET_SORTS.map((s) => ({ value: s, label: s.replace(/_/g, ' ') }))} defaultValue={params.sort} className="w-36" />
        <SelectField id="dir" name="dir" label="Order" options={[{ value: 'desc', label: 'Descending' }, { value: 'asc', label: 'Ascending' }]} defaultValue={params.dir} className="w-32" />
        <ApplyButton>Filter</ApplyButton>
      </FilterBar>

      <TableCard>
        <Table>
          <thead>
            <tr>
              <Th>Market</Th>
              <Th>Status</Th>
              <Th>Category</Th>
              <Th num sortHref={sortHref('total_volume_usd')} active={params.sort === 'total_volume_usd'}>Volume</Th>
              <Th num sortHref={sortHref('total_bets')} active={params.sort === 'total_bets'}>Bets</Th>
              <Th sortHref={sortHref('closes_at')} active={params.sort === 'closes_at'}>Closes</Th>
              <Th>Outcome</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <Td>
                  <Link href={`/admin/markets/${m.id}`} className="font-medium text-[var(--text-primary)] hover:text-[var(--green)]">
                    {m.title ?? m.slug ?? m.id}
                  </Link>
                  <div className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                    <span>by {m.creator?.username ?? m.creator?.display_name ?? '—'}</span>
                    {m.is_featured && <Pill tone="amber"><IconStar size={10} /> Featured</Pill>}
                    {m.is_trending && <Pill tone="red"><IconFire size={10} /> Trending</Pill>}
                  </div>
                </Td>
                <Td><MarketStatusBadge status={m.status} /></Td>
                <Td><span className="capitalize text-[var(--text-secondary)]">{m.category ?? '—'}</span></Td>
                <Td num>{money(m.total_volume_usd)}</Td>
                <Td num>{(m.total_bets ?? 0).toLocaleString()}</Td>
                <Td><span className="text-xs text-[var(--text-muted)]">{m.closes_at ? new Date(m.closes_at).toLocaleDateString() : '—'}</span></Td>
                <Td><OutcomeBadge outcome={m.resolved_outcome} /></Td>
              </tr>
            ))}
            {rows.length === 0 && (
              <EmptyRow colSpan={7}>
                <span className="inline-flex items-center gap-2"><IconMarkets size={16} /> No events match these filters.</span>
              </EmptyRow>
            )}
          </tbody>
        </Table>
      </TableCard>

      <Pagination page={params.page} pageSize={params.pageSize} total={total} hrefForPage={(p) => `/admin/markets?${qs(params, { page: p })}`} />
    </div>
  )
}
