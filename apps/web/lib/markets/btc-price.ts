// lib/markets/btc-price.ts
// ---------------------------------------------------------------------------
// Server-side BTC/USD spot price with a resilient, key-less fallback chain.
//
// The recurring "Bitcoin Up or Down" engine samples this every minute. We try
// several free, generous, public endpoints in order until one returns a sane
// positive number, so a single provider outage never stalls the engine.
// Binance is intentionally omitted — it returns HTTP 451 from many regions.
// ---------------------------------------------------------------------------

export interface BtcSpot {
  /** BTC/USD spot price. */
  price: number
  /** Which provider answered (for the oracle audit trail). */
  source: string
}

const TIMEOUT_MS = 6000

async function fetchJson(url: string): Promise<unknown> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as unknown
  } finally {
    clearTimeout(timer)
  }
}

/** Coerce a string|number to a finite, strictly-positive number, else null. */
function positiveNumber(x: unknown): number | null {
  const n = typeof x === 'string' ? parseFloat(x) : typeof x === 'number' ? x : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

interface PriceSource {
  name: string
  url: string
  pick: (json: unknown) => number | null
}

// Ordered by preference: Coinbase (fast, stable) → Kraken → CoinGecko.
const SOURCES: PriceSource[] = [
  {
    name: 'coinbase',
    url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
    pick: (j) => positiveNumber((j as { data?: { amount?: unknown } })?.data?.amount),
  },
  {
    name: 'kraken',
    url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
    pick: (j) => {
      const result = (j as { result?: Record<string, { c?: unknown[] }> })?.result
      const key = result && Object.keys(result)[0]
      const last = key ? result[key]?.c?.[0] : undefined
      return positiveNumber(last)
    },
  },
  {
    name: 'coingecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    pick: (j) => positiveNumber((j as { bitcoin?: { usd?: unknown } })?.bitcoin?.usd),
  },
]

/**
 * Fetch BTC/USD spot, trying each source until one succeeds.
 * @throws if every source fails or returns an unparseable payload.
 */
export async function fetchBtcSpot(): Promise<BtcSpot> {
  const errors: string[] = []
  for (const source of SOURCES) {
    try {
      const json = await fetchJson(source.url)
      const price = source.pick(json)
      if (price != null) return { price, source: source.name }
      errors.push(`${source.name}: unparseable payload`)
    } catch (e) {
      errors.push(`${source.name}: ${e instanceof Error ? e.message : 'error'}`)
    }
  }
  throw new Error(`All BTC price sources failed — ${errors.join('; ')}`)
}

/** One per-second sample, as `record_btc_ticks` expects it. */
export interface BtcTick {
  /** ISO-8601 instant, truncated to the second by the database. */
  t: string
  /** BTC/USD price for that second. */
  p: number
}

/**
 * Per-second BTC/USD samples from the exchange's recent trade prints.
 *
 * WHY THIS EXISTS. Settlement needs a 60-second TWAP, and a TWAP needs samples
 * inside those 60 seconds. pg_cron cannot run faster than once a minute, and it
 * showed: measured on production, 28 ticks in 30 minutes, an average gap of 65
 * seconds. Density therefore has to come from each run fetching a stretch of
 * history rather than from the scheduler ticking faster.
 *
 * Coinbase's public trade feed returns the last 1000 prints, which on BTC-USD
 * is about five minutes, so a per-minute run with a 90-second reach always
 * overlaps the previous one and leaves no hole even if a run is slow or
 * skipped. The prints are bucketed to the last price in each second, which is
 * the cadence Polymarket publishes its own TWAP stream at and plenty to
 * average over.
 *
 * Same exchange as fetchBtcSpot's first choice and as the chart, so the
 * reference price, the plotted line and the settlement all read one book.
 */
export async function fetchBtcTradeTicks(lookbackSeconds = 90): Promise<BtcTick[]> {
  const rows = await fetchJson('https://api.exchange.coinbase.com/products/BTC-USD/trades?limit=1000')
  if (!Array.isArray(rows)) return []

  const cutoff = Date.now() - Math.max(1, lookbackSeconds) * 1000
  /** second (ms) -> the freshest print in it */
  const bySecond = new Map<number, { ms: number; price: number }>()

  for (const row of rows as { time?: unknown; price?: unknown }[]) {
    const price = positiveNumber(row?.price)
    const ms = typeof row?.time === 'string' ? Date.parse(row.time) : NaN
    if (price == null || !Number.isFinite(ms) || ms < cutoff) continue
    const second = Math.floor(ms / 1000) * 1000
    const held = bySecond.get(second)
    // Trades arrive newest-first; keep the latest print within the second so a
    // second's sample is its close, matching how the chart buckets candles.
    if (!held || ms > held.ms) bySecond.set(second, { ms, price })
  }

  return [...bySecond.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([second, v]) => ({ t: new Date(second).toISOString(), p: v.price }))
}
