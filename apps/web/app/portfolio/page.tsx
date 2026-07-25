// app/portfolio/page.tsx — Portfolio (live mark-to-market)
// Institutional dashboard: KPI band + allocation donut + holdings book +
// activity. All figures are computed server-side against LIVE prices (never the
// stale positions.current_value_usd snapshot). Pure Pip system, no emoji.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { summarizePortfolio, toValuationInput } from '@/lib/portfolio'
import { buildRatesMap, localToUsd } from '@/lib/currency'
import type { Position, Transaction, Wallet, CurrencyCode, MarketStatus } from '@/types'
import { SummaryCards } from '@/components/portfolio/summary-cards'
import { AllocationDonut, type AllocationSlice } from '@/components/portfolio/allocation-donut'
import { HoldingsTable, type HoldingRow } from '@/components/portfolio/holdings-table'
import { TransactionHistory } from '@/components/portfolio/transaction-history'
import { PortfolioFundingActions } from '@/components/portfolio/funding-actions'

// Personal data — render dynamically per request, never prerender or index.
export const dynamic = 'force-dynamic'

export const metadata = { title: 'My Portfolio', robots: { index: false, follow: false } }

type JoinedMarket = {
  id: string
  title: string
  slug: string
  yes_price: number
  no_price: number
  status: MarketStatus
  resolved_outcome: 'yes' | 'no' | null
  resolved_option_id: string | null
  closes_at: string
}

const OUTCOME_LABEL: Record<string, string> = {
  active: 'Open',
  resolved_win: 'Won',
  resolved_loss: 'Lost',
  cancelled: 'Refunded',
}

async function PortfolioData() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const [positionsRes, transactionsRes, walletsRes, ratesRes] = await Promise.all([
    supabase
      .from('positions')
      .select(
        `*, market:markets(id, title, slug, yes_price, no_price, status, resolved_outcome, resolved_option_id, closes_at)`,
      )
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.from('wallets').select('*').eq('user_id', user.id),
    supabase.from('exchange_rates').select('from_currency, rate').eq('to_currency', 'USD'),
  ])

  const positions = (positionsRes.data || []) as (Position & { market: JoinedMarket | null })[]
  const transactions = (transactionsRes.data || []) as Transaction[]
  const wallets = (walletsRes.data || []) as Wallet[]
  const rates = buildRatesMap(
    (ratesRes.data as { from_currency: string; rate: number | string | null }[]) ?? [],
  )

  // Resolve the option rows behind multiple_choice positions (label for the
  // holdings table, live price + winner flag for valuation).
  const optionIds = Array.from(
    new Set(positions.map((p) => p.market_option_id).filter((id): id is string => !!id)),
  )
  const optionsById = new Map<
    string,
    { label: string; price: number; is_winner: boolean | null }
  >()
  if (optionIds.length > 0) {
    const { data: optionRows } = await supabase
      .from('market_options')
      .select('id, label, price, is_winner')
      .in('id', optionIds)
    for (const o of (optionRows as {
      id: string
      label: string
      price: number
      is_winner: boolean | null
    }[]) ?? []) {
      optionsById.set(o.id, { label: o.label, price: o.price, is_winner: o.is_winner })
    }
  }

  // Live mark-to-market P&L (single source of truth). Option positions are
  // normalized to the binary valuation model via toValuationInput.
  const { summary, positions: pnl } = summarizePortfolio(
    positions.map((p) =>
      toValuationInput(
        {
          id: p.id,
          side: p.side,
          market_option_id: p.market_option_id,
          shares: p.shares,
          total_invested_usd: p.total_invested_usd,
          is_active: p.is_active,
        },
        p.market ?? null,
        p.market_option_id ? optionsById.get(p.market_option_id) : null,
      ),
    ),
  )
  const pnlById = new Map(pnl.map((c) => [c.positionId, c]))

  // Cash across wallets, normalized to USD.
  const cashUsd = wallets.reduce(
    (sum, w) => sum + localToUsd(w.available_balance, w.currency as CurrencyCode, rates),
    0,
  )

  // Open holdings (active, price-sensitive) drive the table + donut + weights.
  const openPositions = positions.filter((p) => {
    const c = pnlById.get(p.id)
    return c && !c.isSettled && p.market
  })
  const totalOpenValue = openPositions.reduce(
    (s, p) => s + (pnlById.get(p.id)?.currentValue ?? 0),
    0,
  )

  // Today's P&L: mark each held market at its first tick since 00:00 UTC and
  // sum the change in value. Markets with no tick today contribute nothing.
  let todayPnl = 0
  const marketIds = openPositions.map((p) => p.market!.id)
  if (marketIds.length > 0) {
    const startOfDay = new Date()
    startOfDay.setUTCHours(0, 0, 0, 0)
    const { data: history } = await supabase
      .from('price_history')
      .select('market_id, market_option_id, yes_price, no_price, price, recorded_at')
      .in('market_id', marketIds)
      .gte('recorded_at', startOfDay.toISOString())
      .order('recorded_at', { ascending: true })

    // Binary markets: first tick keyed by market. Option markets: first tick
    // keyed by option id (price_history rows carry market_option_id + price).
    const dayOpen = new Map<string, { yes: number; no: number }>()
    const dayOpenOption = new Map<string, number>()
    for (const row of (history as {
      market_id: string
      market_option_id: string | null
      yes_price: number | null
      no_price: number | null
      price: number | null
    }[]) ?? []) {
      if (row.market_option_id) {
        if (!dayOpenOption.has(row.market_option_id) && row.price != null) {
          dayOpenOption.set(row.market_option_id, row.price)
        }
      } else if (!dayOpen.has(row.market_id) && row.yes_price != null && row.no_price != null) {
        dayOpen.set(row.market_id, { yes: row.yes_price, no: row.no_price })
      }
    }
    for (const p of openPositions) {
      const c = pnlById.get(p.id)
      if (!c) continue
      let openPrice: number | undefined
      if (p.market_option_id) {
        openPrice = dayOpenOption.get(p.market_option_id)
      } else {
        const open = dayOpen.get(p.market!.id)
        openPrice = open ? (p.side === 'yes' ? open.yes : open.no) : undefined
      }
      if (openPrice == null) continue
      const openValue = p.shares * openPrice
      todayPnl += c.currentValue - openValue
    }
  }

  const totalValue = summary.totalCurrentValue + cashUsd

  const holdings: HoldingRow[] = openPositions
    .map((p) => {
      const c = pnlById.get(p.id)!
      const option = p.market_option_id ? optionsById.get(p.market_option_id) : null
      return {
        id: p.id,
        title: p.market!.title,
        slug: p.market!.slug,
        side: (option ? 'option' : p.side ?? 'yes') as HoldingRow['side'],
        optionLabel: option?.label,
        shares: p.shares,
        avgCost: p.avg_entry_price,
        livePrice: c.markPrice,
        marketValue: c.currentValue,
        invested: c.invested,
        pnl: c.totalPnl,
        pnlPct: c.pnlPct,
        weight: totalOpenValue > 0 ? c.currentValue / totalOpenValue : 0,
        isSettled: c.isSettled,
        outcomeLabel: OUTCOME_LABEL[c.outcome] ?? 'Open',
      }
    })
    .sort((a, b) => b.marketValue - a.marketValue)

  const slices: AllocationSlice[] = holdings.map((h) => ({
    label: h.optionLabel ? `${h.title} — ${h.optionLabel}` : h.title,
    value: h.marketValue,
    side: h.side,
  }))

  return (
    <div className="space-y-6">
      <SummaryCards
        totalValue={totalValue}
        unrealizedPnl={summary.totalUnrealizedPnl}
        unrealizedPnlPct={summary.unrealizedPnlPct}
        todayPnl={todayPnl}
        cashUsd={cashUsd}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-text-secondary">Holdings</h2>
          <HoldingsTable holdings={holdings} />
        </div>
        <div>
          <AllocationDonut slices={slices} />
          {summary.totalRealizedPnl !== 0 && (
            <div className="card mt-4 p-4">
              <p className="text-xs font-medium text-text-muted">Realized P&amp;L (settled)</p>
              <p
                className={`mt-1 font-mono text-lg font-bold ${
                  summary.totalRealizedPnl >= 0 ? 'text-yes' : 'text-no'
                }`}
              >
                {summary.totalRealizedPnl >= 0 ? '+' : ''}
                {summary.totalRealizedPnl.toFixed(2)} USD
              </p>
              <p className="mt-0.5 text-xs text-text-muted">
                Across {summary.settledCount} settled position{summary.settledCount === 1 ? '' : 's'}
              </p>
            </div>
          )}
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-text-secondary">Recent activity</h2>
        <TransactionHistory transactions={transactions} />
      </section>
    </div>
  )
}

export default function PortfolioPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl text-text-primary">My Portfolio</h1>
        <PortfolioFundingActions />
      </div>
      <PortfolioData />
    </div>
  )
}
