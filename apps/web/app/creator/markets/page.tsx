// app/creator/markets/page.tsx — The creator's own markets.
//
// Lists every market where creator_id = auth.uid() (RLS-scoped), across all
// lifecycle states (draft / pending / active / closed / resolved / …). Volume is
// stored in USD and rendered in KES via the canonical converter threaded with a
// LIVE exchange_rates map. Each row links to the public market page.
import Link from 'next/link'
import { requireCreator } from '@/lib/creator/guard'
import { buildRatesMap } from '@/lib/currency'
import { kes } from '@/lib/admin/money'
import { num, type CreatorMarketRow } from '@/lib/creator/earnings'
import {
  TableCard, Table, Th, Td, Pill, toneFor, EmptyRow, type PillTone,
} from '@/components/admin/ui'
import { IconExternalLink } from '@/components/ui/icons'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Creator Console · Markets', robots: { index: false, follow: false } }

interface MarketRow extends CreatorMarketRow {
  slug: string | null
  title: string | null
}

const STATUS_TONE: Record<string, PillTone> = {
  draft: 'slate',
  pending: 'amber',
  active: 'green',
  closed: 'blue',
  resolved: 'violet',
  disputed: 'red',
  cancelled: 'red',
}

export default async function CreatorMarketsPage() {
  const ctx = await requireCreator()
  const sb = ctx.supabase

  const [marketsRes, ratesRes] = await Promise.all([
    sb
      .from('markets')
      .select('id, slug, title, status, total_volume_usd, creator_reward_rate, unique_bettors, created_at')
      .eq('creator_id', ctx.user.id)
      .order('created_at', { ascending: false }),
    sb.from('exchange_rates').select('from_currency, rate').eq('to_currency', 'USD'),
  ])

  const rates = buildRatesMap((ratesRes.data ?? []) as Array<{ from_currency: string; rate: number | string | null }>)
  const markets = (marketsRes.data ?? []) as MarketRow[]

  return (
    <section aria-labelledby="creator-markets-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="creator-markets-heading" className="text-sm font-semibold text-[var(--text-secondary)]">
          {markets.length.toLocaleString()} market{markets.length === 1 ? '' : 's'}
        </h2>
      </div>

      <TableCard>
        <Table>
          <thead>
            <tr>
              <Th>Market</Th>
              <Th>Status</Th>
              <Th num>Volume (KES)</Th>
              <Th num>Bettors</Th>
              <Th>Created</Th>
              <Th>Public</Th>
            </tr>
          </thead>
          <tbody>
            {markets.length === 0 ? (
              <EmptyRow colSpan={6}>You haven&apos;t created any markets yet.</EmptyRow>
            ) : (
              markets.map((m) => (
                <tr key={m.id}>
                  <Td>
                    <span className="font-medium text-[var(--text-primary)]">{m.title ?? 'Untitled market'}</span>
                  </Td>
                  <Td>
                    <Pill tone={toneFor(m.status, STATUS_TONE, 'neutral')} dot>
                      {m.status}
                    </Pill>
                  </Td>
                  <Td num>{kes(m.total_volume_usd, rates)}</Td>
                  <Td num>{num(m.unique_bettors).toLocaleString()}</Td>
                  <Td>
                    <span className="text-xs text-[var(--text-muted)]">
                      {new Date(m.created_at).toLocaleDateString('en-KE')}
                    </span>
                  </Td>
                  <Td>
                    {m.slug ? (
                      <Link
                        href={`/markets/${m.slug}`}
                        className="inline-flex items-center gap-1 text-[var(--pip-500)] hover:underline"
                      >
                        View <IconExternalLink size={12} aria-hidden />
                        <span className="sr-only">public page for {m.title ?? 'market'}</span>
                      </Link>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">—</span>
                    )}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </TableCard>
    </section>
  )
}
