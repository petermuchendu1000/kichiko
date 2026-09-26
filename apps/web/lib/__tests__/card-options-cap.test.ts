import { describe, it, expect } from 'vitest'
import { getCardOptions } from '@/lib/markets/card-options'
import { getLeadingOptions } from '@/lib/markets/leading-options'

// Audit 6.43: both helpers read every option of every market on the page in one
// unordered request; PostgREST returns at most max_rows (1,000) rows, so past
// that the counts and front-runners were wrong. They now use the ranked RPC
// market_card_options (migration 097), which returns only the top rows + counts.
type Opt = { id: string; market_id: string; label: string; price: number | null; yes_price: number | null; image_url: string | null; display_order: number }
const BIG = 'm-big', SMALL = 'm-small'
const options: Opt[] = [
  ...Array.from({ length: 1200 }, (_, i) => ({ id: `b${String(i).padStart(4, '0')}`, market_id: BIG, label: `B${i}`, price: 0.5, yes_price: i / 1200, image_url: null, display_order: i })),
  ...Array.from({ length: 3 }, (_, i) => ({ id: `s${i}`, market_id: SMALL, label: `S${i}`, price: null, yes_price: [0.2, 0.7, 0.1][i], image_url: null, display_order: i })),
]
const rank = (o: Opt) => o.yes_price ?? o.price ?? 0

function client() {
  return {
    // the table read, as PostgREST serves it: unordered, at most 1,000 rows
    from: () => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.in = () => b
      b.then = (res: (v: unknown) => void) => res({ data: options.slice(0, 1000), error: null })
      return b
    },
    // the ranked RPC (097): top N per market + the market's option count
    rpc: async (fn: string, args: { p_market_ids: string[]; p_per_market: number }) => {
      if (fn !== 'market_card_options') throw new Error('unexpected rpc ' + fn)
      const rows = args.p_market_ids.flatMap((m) => {
        const all = options.filter((o) => o.market_id === m)
        return [...all].sort((a, b) => rank(b) - rank(a) || a.display_order - b.display_order)
          .slice(0, args.p_per_market)
          .map((o) => ({ market_id: m, id: o.id, label: o.label, price: rank(o), image_url: o.image_url, option_count: all.length }))
      })
      return { data: rows, error: null }
    },
  }
}

describe('card options past PostgREST max_rows', () => {
  it('getCardOptions: exact counts and the real front-runners', async () => {
    const r = await getCardOptions(client() as never, [BIG, SMALL], 2)
    expect(r.countByMarket.get(BIG)).toBe(1200)
    expect(r.topByMarket.get(BIG)?.map((o) => o.label)).toEqual(['B1199', 'B1198'])
    expect(r.countByMarket.get(SMALL)).toBe(3)
    expect(r.topByMarket.get(SMALL)?.map((o) => o.label)).toEqual(['S1', 'S0'])
  })
  it('getLeadingOptions: the real leader and count', async () => {
    const r = await getLeadingOptions(client() as never, [BIG, SMALL])
    expect(r.leadByMarket.get(BIG)).toEqual({ label: 'B1199', price: 1199 / 1200 })
    expect(r.countByMarket.get(BIG)).toBe(1200)
    expect(r.leadByMarket.get(SMALL)?.label).toBe('S1')
  })
})
