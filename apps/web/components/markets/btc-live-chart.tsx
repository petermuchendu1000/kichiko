'use client'

// components/markets/btc-live-chart.tsx
// ---------------------------------------------------------------------------
// Real-time BTC/USD chart for the recurring "Bitcoin Up or Down" windows — a
// close clone of Polymarket's BTC Up-or-Down market chart. Polymarket offers
// THREE views, toggled by the icon cluster at the bottom-right:
//
//   1. Probability line  (line icon)   — "UP xx% chance", a blue % line 0–100.
//   2. BTC price / area  (₿ icon)      — the orange spot line with a dashed
//                                         Target strike and a right price axis.
//   3. Candlesticks      (candle icon) — green/red OHLC candles of the spot.
//
// All three share ONE live feed and ONE time domain, so switching views is
// instant and consistent. The header adapts to the active view (chance vs.
// price-to-beat + current price), exactly like Polymarket.
//
// PROBABILITY MODEL: these windows have no order book to read a market price
// from tick-by-tick, so the "UP chance" is the implied probability that spot
// finishes above the strike — a logistic of (spot − strike) scaled by the
// volatility still in play over the remaining time. Early in a window it hovers
// near 50%; as the clock runs down and price separates it saturates toward
// 100%/0% — the same shape Polymarket's chance line traces.
//
// FEED (robust, key-less, free): a REST spot poll (api.coinbase.com, CORS-open)
// runs as the always-on baseline so the line is NEVER empty, and Coinbase's
// public WebSocket ticker (wss://ws-feed.exchange.coinbase.com) layers on
// smoother sub-second ticks when it connects. Recent history is best-effort
// seeded from Coinbase candles. Coinbase is the same source the server oracle
// settles against, so the chart and settlement agree.
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AreaChart, Area, ComposedChart, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot, Customized,
} from 'recharts'
import { format } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { IconArrowUp, IconArrowDown } from '@/components/ui/icons'
import {
  impliedUpProb,
  isWindowClosed,
  candleBucketMs,
  bucketCandles,
  mergeLiveCandle,
  pickGranularity,
  pastWindows,
  windowOutcome,
  pickSuccessorWindow,
  type ChartType,
  type Pt,
  type Candle,
  type SeriesWindow,
} from '@/lib/markets/btc-chart'

const BTC_ORANGE = '#F7931A'
const PROB_BLUE = '#2B50E4'
const UP_GREEN = '#1F9D6B'
const DOWN_RED = '#D1495B'

interface BtcLiveChartProps {
  marketId: string
  /** Current market slug — used to highlight the active row in the Past nav. */
  slug?: string
  /** metadata.series_key (e.g. 'btc-up-down-5m') — scopes the Past nav query. */
  seriesKey?: string
  referencePrice: number
  closesAt: string
  windowSeconds: number
  upLabel?: string
  downLabel?: string
  status?: string
}

interface Sibling {
  slug: string
  label: string
  closes_at: string
  window_seconds: number
}

const usd = (n: number, dp = 0) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dp, maximumFractionDigits: dp })

function Tip({ active, payload, label, kind }: {
  active?: boolean; payload?: { value: number }[]; label?: string | number; kind: ChartType
}) {
  if (!active || !payload?.length) return null
  const v = payload[0]?.value ?? 0
  return (
    <div className="rounded-md border border-hairline px-3 py-2 text-sm shadow-lg" style={{ background: 'var(--surface)' }}>
      <p className="mb-0.5 text-xs text-text-muted">{label ? format(new Date(Number(label)), 'HH:mm:ss') : ''}</p>
      <p className="font-mono font-semibold" style={{ color: kind === 'prob' ? PROB_BLUE : BTC_ORANGE }}>
        {kind === 'prob' ? `${v.toFixed(0)}%` : usd(v, 2)}
      </p>
    </div>
  )
}

/** Pulsing "live" marker for a recharts ReferenceDot `shape`: a solid dot with
 *  a halo ring that expands and fades on a loop (simulates a live tick). Reuses
 *  the app-wide `.pm-endpoint-pulse` keyframes from globals.css. */
function LivePulseDot({ cx, cy, color }: { cx?: number; cy?: number; color: string }) {
  if (cx == null || cy == null) return <g />
  return (
    <g style={{ pointerEvents: 'none' }}>
      <circle
        cx={cx}
        cy={cy}
        r={4}
        fill={color}
        className="pm-endpoint-pulse"
        style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
      />
      <circle cx={cx} cy={cy} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
    </g>
  )
}

export function BtcLiveChart({
  marketId,
  slug,
  seriesKey,
  referencePrice,
  closesAt,
  windowSeconds,
  upLabel = 'Up',
  downLabel = 'Down',
  status = 'active',
}: BtcLiveChartProps) {
  const closeMs = useMemo(() => new Date(closesAt).getTime(), [closesAt])
  const openMs = useMemo(() => closeMs - windowSeconds * 1000, [closeMs, windowSeconds])

  const [points, setPoints] = useState<Pt[]>([{ t: openMs, price: referencePrice }])
  const [live, setLive] = useState<number>(referencePrice)
  const [connected, setConnected] = useState(false)
  const [chartType, setChartType] = useState<ChartType>('price')
  // Seed `now` from a DETERMINISTIC, prop-derived value (the window open time)
  // so the server render and the first client render produce identical
  // countdown / "Live" text (no hydration mismatch). The interval below swaps
  // in the real wall-clock immediately after mount, so the countdown is live.
  const [now, setNow] = useState<number>(openMs)
  const [siblings, setSiblings] = useState<Sibling[]>([])
  // Real Coinbase OHLC candles (authoritative pips) for the candlestick view.
  const [realCandles, setRealCandles] = useState<Candle[]>([])
  // Every window in THIS recurring series (live + resolved) — powers the
  // "Past ▾" navigator and the window-close successor auto-advance.
  const [seriesRows, setSeriesRows] = useState<SeriesWindow[]>([])
  const lastPush = useRef<number>(0)

  // Coinbase candle granularity chosen for this window length (5M/15M/30M/1H
  // all resolve to 60s; larger windows step up). One source of truth so the
  // fetch and the live-candle merge agree on bucket size.
  const granularity = useMemo(() => pickGranularity(windowSeconds), [windowSeconds])

  const windowClosed = isWindowClosed(status, closeMs, now)

  // 1s clock (countdown + freezes the series at the close boundary).
  useEffect(() => {
    setNow(Date.now()) // adopt the real clock the moment we're on the client
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Sibling live windows for the 5M · 15M · 30M · 1H chips.
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('markets')
      .select('slug, closes_at, metadata')
      .eq('status', 'active')
      .contains('metadata', { card_kind: 'up_down' })
      .order('featured_order', { ascending: true })
      .then(({ data }) => {
        if (!data) return
        setSiblings(
          data.map((m) => {
            const meta = (m.metadata ?? {}) as Record<string, unknown>
            return {
              slug: m.slug as string,
              label: String(meta.window_label ?? ''),
              closes_at: m.closes_at as string,
              window_seconds: Number(meta.window_seconds ?? 0),
            }
          }),
        )
      })
  }, [marketId])

  // All windows in THIS series (live + recently resolved) for the Past nav and
  // the close-without-refresh successor swap. Polled every 20s while live so a
  // freshly-opened successor and the just-resolved outcome both appear without
  // a page refresh. Degrades to [] (nav hidden) on any error.
  useEffect(() => {
    if (!seriesKey) return
    const supabase = createClient()
    let alive = true
    const load = () => {
      supabase
        .from('markets')
        .select('slug, status, closes_at, resolved_outcome, metadata')
        .contains('metadata', { series_key: seriesKey })
        .order('closes_at', { ascending: false })
        .limit(24)
        .then(({ data }) => {
          if (!alive || !data) return
          setSeriesRows(
            data.map((m) => {
              const meta = (m.metadata ?? {}) as Record<string, unknown>
              return {
                slug: m.slug as string,
                status: m.status as string,
                closesAt: m.closes_at as string,
                windowSeconds: Number(meta.window_seconds ?? 0),
                label: String(meta.window_label ?? ''),
                referencePrice: meta.reference_price != null ? Number(meta.reference_price) : null,
                settlePrice: meta.settle_price != null ? Number(meta.settle_price) : null,
                resolvedOutcome: (m.resolved_outcome as string | null) ?? null,
              }
            }),
          )
        })
    }
    load()
    const id = setInterval(load, 20_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [seriesKey, marketId])

  const pastRows = useMemo(() => pastWindows(seriesRows, 10), [seriesRows])
  const [navOpen, setNavOpen] = useState(false)
  const router = useRouter()

  // This window's OWN resolved outcome, once the 20s poller has picked it up
  // after close — lets us flash "Up won / Down won" without a refresh.
  const currentOutcome = useMemo(() => {
    const self = seriesRows.find((w) => w.slug === slug && w.status === 'resolved')
    return self ? windowOutcome(self) : null
  }, [seriesRows, slug])

  // The live window a trader should move to once this one closes (same length,
  // else any live sibling). Only relevant while the window is closed.
  const successor = useMemo(
    () => (windowClosed ? pickSuccessorWindow(seriesRows, windowSeconds, now) : null),
    [windowClosed, seriesRows, windowSeconds, now],
  )

  // Auto-advance ONLY when the window closed while the user was watching it live
  // (server rendered it 'active', the clock then crossed close). If they opened
  // a past/resolved window on purpose, show the CTA but never yank them away.
  const closedWhileWatching = status === 'active' && now >= closeMs
  const AUTO_ADVANCE_MS = 6000
  const [advanceLeft, setAdvanceLeft] = useState<number | null>(null)
  useEffect(() => {
    if (!closedWhileWatching || !successor) {
      setAdvanceLeft(null)
      return
    }
    const deadline = Date.now() + AUTO_ADVANCE_MS
    setAdvanceLeft(Math.ceil(AUTO_ADVANCE_MS / 1000))
    const tick = setInterval(() => {
      setAdvanceLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    }, 500)
    const to = setTimeout(() => router.push(`/markets/${successor.slug}`), AUTO_ADVANCE_MS)
    return () => {
      clearInterval(tick)
      clearTimeout(to)
    }
    // Keyed on the successor SLUG so the 1s clock doesn't reset the countdown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedWhileWatching, successor?.slug, router])

  const pushPrice = useMemo(() => {
    return (price: number, force = false) => {
      if (!Number.isFinite(price) || price <= 0) return
      setLive(price)
      const t = Date.now()
      if (!force && t - lastPush.current < 700) return
      lastPush.current = t
      setPoints((prev) => {
        const capped = Math.min(t, closeMs)
        const next = [...prev, { t: capped, price }]
        return next.length > 900 ? next.slice(next.length - 900) : next
      })
    }
  }, [closeMs])

  // Best-effort seed of recent history from Coinbase 1-minute candles.
  useEffect(() => {
    let alive = true
    const startISO = new Date(openMs).toISOString()
    const endISO = new Date(Math.min(closeMs, Date.now() + 1000)).toISOString()
    fetch(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60&start=${startISO}&end=${endISO}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('candles'))))
      .then((rows: number[][]) => {
        if (!alive || !Array.isArray(rows) || rows.length === 0) return
        const seeded: Pt[] = rows
          .map((c) => ({ t: c[0] * 1000, price: c[4] }))
          .filter((p) => p.t >= openMs && p.t <= closeMs)
          .sort((a, b) => a.t - b.t)
        if (seeded.length) {
          setPoints((prev) => {
            const tail = prev.filter((p) => p.t > (seeded.at(-1)?.t ?? openMs))
            return [{ t: openMs, price: referencePrice }, ...seeded, ...tail]
          })
        }
      })
      .catch(() => {/* CORS/region — baseline REST poll fills the line instead */})
    return () => {
      alive = false
    }
  }, [openMs, closeMs, referencePrice])

  // Real Coinbase OHLC candles for the candlestick view — actual [time, low,
  // high, open, close, vol] bars (not spot buckets), the same feed Polymarket's
  // BTC chart uses. Fetched at the window's granularity, refreshed while live.
  // If Coinbase is CORS/region-blocked the candle view degrades to bucketing
  // the live spot series (bucketCandles below).
  useEffect(() => {
    let alive = true
    const load = () => {
      const startISO = new Date(openMs).toISOString()
      const endISO = new Date(Math.min(closeMs, Date.now() + 1000)).toISOString()
      fetch(
        `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${granularity}` +
          `&start=${startISO}&end=${endISO}`,
      )
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('candles'))))
        .then((rows: number[][]) => {
          if (!alive || !Array.isArray(rows)) return
          // Coinbase rows are [time(s), low, high, open, close, volume], newest
          // first — normalise to ascending OHLC candles inside the window.
          const parsed: Candle[] = rows
            .filter((c) => Array.isArray(c) && c.length >= 5)
            .map((c) => ({ t: c[0] * 1000, l: c[1], h: c[2], o: c[3], c: c[4] }))
            .filter((c) => c.t >= openMs && c.t <= closeMs)
            .sort((a, b) => a.t - b.t)
          if (parsed.length) setRealCandles(parsed)
        })
        .catch(() => {/* fall back to bucketed spot candles */})
    }
    load()
    // Refresh the real bars periodically while the window is live so freshly
    // closed 1-minute Coinbase candles fill in; stop once the window closes.
    const id = windowClosed ? undefined : setInterval(load, 30_000)
    return () => {
      alive = false
      if (id) clearInterval(id)
    }
  }, [openMs, closeMs, granularity, windowClosed])

  // ALWAYS-ON REST spot poll — guarantees a moving line even if the socket is
  // blocked. api.coinbase.com is CORS-open, so this works from any browser.
  useEffect(() => {
    if (windowClosed) return
    let alive = true
    const tick = () =>
      fetch('https://api.coinbase.com/v2/prices/BTC-USD/spot')
        .then((r) => r.json())
        .then((j) => {
          if (alive) pushPrice(parseFloat(j?.data?.amount))
        })
        .catch(() => {})
    tick()
    const id = setInterval(tick, 2500)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [windowClosed, pushPrice])

  // Coinbase WebSocket ticker — smoother sub-second ticks when reachable.
  useEffect(() => {
    if (windowClosed) return
    let ws: WebSocket | null = null
    let closedByUs = false
    try {
      ws = new WebSocket('wss://ws-feed.exchange.coinbase.com')
      ws.onopen = () => {
        setConnected(true)
        ws?.send(JSON.stringify({ type: 'subscribe', product_ids: ['BTC-USD'], channels: ['ticker'] }))
      }
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data)
          if (m.type === 'ticker' && m.product_id === 'BTC-USD') pushPrice(parseFloat(m.price))
        } catch {/* ignore */}
      }
      ws.onerror = () => setConnected(false)
      ws.onclose = () => {
        if (!closedByUs) setConnected(false)
      }
    } catch {/* REST poll covers us */}
    return () => {
      closedByUs = true
      setConnected(false)
      try {
        ws?.close()
      } catch {/* already closed */}
    }
  }, [windowClosed, pushPrice])

  const isUp = live >= referencePrice
  const delta = live - referencePrice
  const deltaPct = referencePrice > 0 ? (delta / referencePrice) * 100 : 0
  const leanTone = isUp ? UP_GREEN : DOWN_RED

  const remainingMs = Math.max(0, closeMs - now)
  const remainingSec = remainingMs / 1000
  const mm = Math.floor(remainingMs / 60000)
  const ss = Math.floor((remainingMs % 60000) / 1000)
  const countdown = windowClosed ? 'Window closed' : `${mm}:${ss.toString().padStart(2, '0')} left`

  // Right edge tracks NOW (clamped to close) so the line always fills the full
  // width and grows left-to-right as the window progresses — Polymarket's
  // live-growing domain, instead of leaving empty space out to the close time.
  const rightMs = windowClosed ? closeMs : Math.min(closeMs, Math.max(now, openMs + 1000))

  const prices = points.map((p) => p.price)
  const lo = Math.min(referencePrice, ...prices)
  const hi = Math.max(referencePrice, ...prices)
  const pad = Math.max((hi - lo) * 0.2, referencePrice * 0.0006)
  const last = points[points.length - 1]

  // ---- Candlesticks --------------------------------------------------------
  // Prefer REAL Coinbase OHLC bars; while the window is live, layer a single
  // in-progress candle built from the freshest spot ticks so the tail keeps
  // moving between 1-minute bars. If Coinbase is unreachable, fall back to
  // bucketing the live spot series into ~44 synthetic candles.
  const candles = useMemo<Candle[]>(() => {
    if (realCandles.length > 0) {
      return windowClosed ? realCandles : mergeLiveCandle(realCandles, points, granularity)
    }
    return bucketCandles(points, openMs, closeMs, 44)
  }, [realCandles, points, openMs, closeMs, granularity, windowClosed])

  // Candle spacing (ms) — real bars use the granularity; synthetic ones use the
  // bucket width. Drives the candle body width in the SVG layer below.
  const bucketMs = useMemo(
    () => (realCandles.length > 0 ? granularity * 1000 : candleBucketMs(openMs, closeMs, 44)),
    [realCandles.length, granularity, openMs, closeMs],
  )

  // Candle view has its own price domain: real OHLC wicks can reach past the
  // spot line's min/max, so widen the axis to include every high/low + strike.
  const candleLo = candles.length ? Math.min(lo, ...candles.map((c) => c.l)) : lo
  const candleHi = candles.length ? Math.max(hi, ...candles.map((c) => c.h)) : hi
  const candlePad = Math.max((candleHi - candleLo) * 0.2, referencePrice * 0.0006)

  // ---- Probability series: implied UP chance over time ---------------------
  const probPoints = useMemo(
    () =>
      points.map((p) => ({
        t: p.t,
        prob: impliedUpProb(p.price, referencePrice, Math.max(0, (closeMs - p.t) / 1000)),
      })),
    [points, referencePrice, closeMs],
  )
  const liveProb = impliedUpProb(live, referencePrice, remainingSec)
  const probLean = liveProb >= 50
  // Probability axis.
  //
  // A FIXED ±8 PADDING FLATTENED THE LINE. On a 15-minute market the implied
  // chance typically travels two or three points, and padding that by eight on
  // each side gives a ~19pt window in which the data occupies about 16% of the
  // plot height: a nearly straight line pinned through the middle of a lot of
  // white, which is what it looked like. The padding was five times the signal.
  //
  // Scale it to the range instead, with a floor so a dead-flat minute does not
  // zoom into its own rounding noise.
  const probVals = probPoints.map((p) => p.prob)
  const pDataLo = Math.min(...probVals, liveProb)
  const pDataHi = Math.max(...probVals, liveProb)
  const pPad = Math.max(1.5, (pDataHi - pDataLo) * 0.35)
  // 50 is this market's decision boundary, so it stays in frame: the dashed
  // reference line and "which side is ahead" are the chart's whole point, and
  // a zoomed domain that excluded 50 would drop both.
  const pLo = Math.max(0, Math.min(pDataLo - pPad, 48))
  const pHi = Math.min(100, Math.max(pDataHi + pPad, 52))

  // Candle geometry drawn against recharts' own axis scales (so it stays in
  // sync with the shared time / price domain and stays responsive).
  const CandleLayer = (cprops: unknown) => {
    const props = cprops as {
      xAxisMap?: Record<string, { scale: (v: number) => number }>
      yAxisMap?: Record<string, { scale: (v: number) => number }>
    }
    const xMap = props.xAxisMap
    const yMap = props.yAxisMap
    if (!xMap || !yMap) return null
    const xScale = Object.values(xMap)[0]?.scale
    const yScale = Object.values(yMap)[0]?.scale
    if (!xScale || !yScale) return null
    const cw = Math.max(2, Math.abs(xScale(openMs + bucketMs) - xScale(openMs)) * 0.62)
    return (
      <g>
        {candles.map((c) => {
          const cx = xScale(c.t)
          const up = c.c >= c.o
          const color = up ? UP_GREEN : DOWN_RED
          const yHigh = yScale(c.h)
          const yLow = yScale(c.l)
          const yOpen = yScale(c.o)
          const yClose = yScale(c.c)
          const bodyTop = Math.min(yOpen, yClose)
          const bodyH = Math.max(1, Math.abs(yClose - yOpen))
          return (
            <g key={c.t}>
              <line x1={cx} x2={cx} y1={yHigh} y2={yLow} stroke={color} strokeWidth={1} />
              <rect x={cx - cw / 2} y={bodyTop} width={cw} height={bodyH} fill={color} rx={0.5} />
            </g>
          )
        })}
      </g>
    )
  }

  const xAxisProps = {
    dataKey: 't',
    type: 'number' as const,
    domain: [openMs, rightMs],
    scale: 'time' as const,
    tickFormatter: (t: number) => format(new Date(Number(t)), 'HH:mm:ss'),
    tick: { fontSize: 10, fill: 'var(--text-muted)' },
    stroke: 'var(--hairline)',
    minTickGap: 56,
  }

  return (
    <div>
      {/* Adaptive header — chance (prob view) OR price-to-beat + current price. */}
      {chartType === 'prob' ? (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: probLean ? UP_GREEN : DOWN_RED }}>
              {probLean ? upLabel : downLabel}
            </p>
            <p className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums" style={{ color: PROB_BLUE }}>
                {liveProb.toFixed(0)}% chance
              </span>
              <span className="flex items-center gap-0.5 text-sm font-semibold tabular-nums" style={{ color: leanTone }}>
                {isUp ? <IconArrowUp size={13} /> : <IconArrowDown size={13} />}
                {Math.abs(deltaPct).toFixed(2)}%
              </span>
            </p>
          </div>
          <span
            className="inline-flex items-center gap-1.5 rounded-pill border border-hairline px-2.5 py-1 text-xs font-semibold"
            style={{ color: windowClosed ? 'var(--text-muted)' : 'var(--no-700)' }}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${!windowClosed ? 'animate-pulse-dot' : ''}`}
              style={{ background: windowClosed ? 'var(--text-muted)' : 'var(--no)' }}
            />
            {windowClosed ? 'Closed' : 'Live'}
          </span>
        </div>
      ) : (
        <>
          {/* Price to beat + Live pill (Polymarket header row) */}
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-text-muted">Price to beat</p>
              <p className="font-mono text-2xl font-bold tabular-nums text-text-primary">{usd(referencePrice, 2)}</p>
            </div>
            <span
              className="inline-flex items-center gap-1.5 rounded-pill border border-hairline px-2.5 py-1 text-xs font-semibold"
              style={{ color: windowClosed ? 'var(--text-muted)' : 'var(--no-700)' }}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${!windowClosed ? 'animate-pulse-dot' : ''}`}
                style={{ background: windowClosed ? 'var(--text-muted)' : 'var(--no)' }}
              />
              {windowClosed ? 'Closed' : 'Live'}
            </span>
          </div>

          {/* Live price + move + Up/Down lean + countdown */}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-lg font-bold tabular-nums" style={{ color: BTC_ORANGE }}>{usd(live, 2)}</span>
              <span className="flex items-center gap-0.5 font-semibold tabular-nums" style={{ color: leanTone }}>
                {isUp ? <IconArrowUp size={13} /> : <IconArrowDown size={13} />}
                {delta >= 0 ? '+' : '−'}{usd(Math.abs(delta), 2)} ({Math.abs(deltaPct).toFixed(2)}%)
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-1 font-semibold" style={{ color: leanTone }}>
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: leanTone }} />
                {isUp ? upLabel : downLabel} leading
              </span>
              <span aria-hidden className="text-text-muted">·</span>
              <span className="tabular-nums text-text-muted">
                {connected && !windowClosed ? 'live · ' : ''}{countdown}
              </span>
            </div>
          </div>
        </>
      )}

      {/* Window-closed banner — appears the instant the clock crosses close
          (no refresh): flashes this window's outcome once resolved and points
          to the live successor, auto-advancing if the user was watching live. */}
      {windowClosed && (successor || currentOutcome) && (
        <div
          className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
          style={{
            borderColor: 'var(--hairline)',
            background: 'var(--surface-2)',
          }}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold text-text-primary">Window closed</span>
            {currentOutcome && (
              <span
                className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-bold"
                style={{
                  color: currentOutcome === 'up' ? UP_GREEN : DOWN_RED,
                  background: currentOutcome === 'up' ? 'rgba(31,157,107,0.12)' : 'rgba(209,73,91,0.12)',
                }}
              >
                {currentOutcome === 'up' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />}
                {(currentOutcome === 'up' ? upLabel : downLabel)} won
              </span>
            )}
          </div>
          {successor && (
            <div className="flex items-center gap-2">
              {advanceLeft != null && advanceLeft > 0 && (
                <span className="text-xs tabular-nums text-text-muted">Advancing in {advanceLeft}s</span>
              )}
              <Link
                href={`/markets/${successor.slug}`}
                className="inline-flex items-center gap-1 rounded-pill px-3 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: PROB_BLUE }}
              >
                Trade live {successor.label} window
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Past-window navigator — browse recently-resolved windows in this
          series, each marked with its Up/Down outcome (Polymarket "Past ▾"). */}
      {pastRows.length > 0 && (
        <PastWindowNav
          past={pastRows}
          currentSlug={slug}
          upLabel={upLabel}
          downLabel={downLabel}
          open={navOpen}
          setOpen={setNavOpen}
        />
      )}

      {/* Chart — one of three synchronized views. */}
      <div className="h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'prob' ? (
            <AreaChart data={probPoints} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <defs>
                {/* 0.18 to nothing over the full height read as a smudge
                    rather than a fill. A stronger top and a mid stop give the
                    area some body without competing with the stroke. */}
                <linearGradient id="probFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={PROB_BLUE} stopOpacity={0.3} />
                  <stop offset="55%" stopColor={PROB_BLUE} stopOpacity={0.1} />
                  <stop offset="100%" stopColor={PROB_BLUE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis {...xAxisProps} />
              <YAxis
                orientation="right"
                domain={[pLo, pHi]}
                tickFormatter={(v) => `${Math.round(Number(v))}%`}
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                stroke="var(--hairline)"
                width={44}
              />
              <Tooltip content={<Tip kind="prob" />} />
              <ReferenceLine y={50} stroke="var(--hairline)" strokeDasharray="4 4" />
              <Area
                type="monotone"
                dataKey="prob"
                stroke={PROB_BLUE}
                strokeWidth={2.5}
                fill="url(#probFill)"
                isAnimationActive={false}
                dot={false}
                activeDot={{ r: 3 }}
              />
              {last && !windowClosed && (
                <ReferenceDot x={last.t} y={liveProb} r={4} shape={(props) => <LivePulseDot {...props} color={PROB_BLUE} />} />
              )}
            </AreaChart>
          ) : chartType === 'candle' ? (
            <ComposedChart data={candles} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <XAxis {...xAxisProps} />
              <YAxis
                orientation="right"
                domain={[candleLo - candlePad, candleHi + candlePad]}
                tickFormatter={(v) => usd(Number(v), 0)}
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                stroke="var(--hairline)"
                width={66}
              />
              <ReferenceLine
                y={referencePrice}
                stroke={BTC_ORANGE}
                strokeDasharray="5 4"
                strokeOpacity={0.7}
                label={{ value: 'Target', position: 'insideTopRight', fontSize: 10, fill: BTC_ORANGE }}
              />
              <ReferenceLine
                y={live}
                stroke="var(--text-muted)"
                strokeDasharray="2 3"
                strokeOpacity={0.6}
              />
              <Customized component={CandleLayer} />
            </ComposedChart>
          ) : (
            <AreaChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="btcFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={BTC_ORANGE} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={BTC_ORANGE} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis {...xAxisProps} />
              <YAxis
                orientation="right"
                domain={[lo - pad, hi + pad]}
                tickFormatter={(v) => usd(Number(v), 0)}
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                stroke="var(--hairline)"
                width={66}
              />
              <Tooltip content={<Tip kind="price" />} />
              <ReferenceLine
                y={referencePrice}
                stroke={BTC_ORANGE}
                strokeDasharray="5 4"
                strokeOpacity={0.7}
                label={{ value: 'Target', position: 'insideTopRight', fontSize: 10, fill: BTC_ORANGE }}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke={BTC_ORANGE}
                strokeWidth={2}
                fill="url(#btcFill)"
                isAnimationActive={false}
                dot={false}
                activeDot={{ r: 3 }}
              />
              {last && !windowClosed && (
                <ReferenceDot x={last.t} y={last.price} r={4} shape={(props) => <LivePulseDot {...props} color={BTC_ORANGE} />} />
              )}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Bottom controls: series chips (left) + chart-type toggle (right). */}
      <div className="mt-3 flex items-center justify-between gap-3">
        {siblings.length > 1 ? (
          <div className="flex flex-wrap gap-1.5">
            {siblings.map((s) => {
              const active = s.window_seconds === windowSeconds
              return (
                <Link
                  key={s.slug}
                  href={`/markets/${s.slug}`}
                  className={`rounded-pill border px-3 py-1 text-xs font-semibold transition-colors ${
                    active
                      ? 'border-transparent bg-text-primary text-surface'
                      : 'border-hairline text-text-secondary hover:bg-surface-2'
                  }`}
                >
                  {s.label}
                </Link>
              )
            })}
          </div>
        ) : (
          <span />
        )}

        <div
          className="inline-flex flex-none items-center gap-0.5 rounded-pill border border-hairline p-0.5"
          role="tablist"
          aria-label="Chart type"
        >
          <ChartToggle active={chartType === 'prob'} onClick={() => setChartType('prob')} label="Probability">
            <IconLineChart size={16} />
          </ChartToggle>
          <ChartToggle active={chartType === 'price'} onClick={() => setChartType('price')} label="BTC price">
            <IconBitcoin size={16} />
          </ChartToggle>
          <ChartToggle active={chartType === 'candle'} onClick={() => setChartType('candle')} label="Candlesticks">
            <IconCandles size={16} />
          </ChartToggle>
        </div>
      </div>

      <p className="mt-2 text-center text-[11px] text-text-muted">
        {chartType === 'prob'
          ? 'Implied Up chance from live BTC/USD (Coinbase) vs the strike'
          : chartType === 'candle'
            ? `Real BTC/USD OHLC candles via Coinbase${realCandles.length ? '' : ' (spot fallback)'} · settles at the reference price`
            : 'Live BTC/USD via Coinbase · settles at the reference price when the window closes'}
      </p>
    </div>
  )
}

/* ---------- Past-window navigator ---------- */

function PastWindowNav({
  past,
  currentSlug,
  upLabel,
  downLabel,
  open,
  setOpen,
}: {
  past: SeriesWindow[]
  currentSlug?: string
  upLabel: string
  downLabel: string
  open: boolean
  setOpen: (v: boolean) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])

  // Newest few as inline quick-chips; the full list lives in the dropdown.
  const chips = past.slice(0, 5)

  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="flex-none text-[11px] font-semibold uppercase tracking-wide text-text-muted">Past</span>

      {/* Inline outcome chips (most recent first). */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
        {chips.map((w) => (
          <PastChip key={w.slug} w={w} active={w.slug === currentSlug} />
        ))}
      </div>

      {/* Dropdown with the full recent history. */}
      <div ref={ref} className="relative flex-none">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1 rounded-pill border border-hairline px-2.5 py-1 text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-2"
        >
          Past
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={open ? 'rotate-180 transition-transform' : 'transition-transform'}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        {open && (
          <div
            role="listbox"
            aria-label="Past windows"
            className="absolute right-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-lg border border-hairline bg-surface p-1 shadow-xl"
          >
            {past.map((w) => {
              const dir = windowOutcome(w)
              const isUp = dir === 'up'
              const color = isUp ? UP_GREEN : DOWN_RED
              const time = format(new Date(w.closesAt), 'HH:mm')
              const active = w.slug === currentSlug
              return (
                <Link
                  key={w.slug}
                  href={`/markets/${w.slug}`}
                  role="option"
                  aria-selected={active}
                  className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm transition-colors ${
                    active ? 'bg-surface-2' : 'hover:bg-surface-2'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 flex-none rounded-full" style={{ background: color }} />
                    <span className="tabular-nums text-text-secondary">{time}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="flex items-center gap-0.5 text-xs font-semibold" style={{ color }}>
                      {isUp ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />}
                      {isUp ? upLabel : downLabel}
                    </span>
                    {w.settlePrice != null && (
                      <span className="tabular-nums text-xs text-text-muted">{usd(w.settlePrice, 0)}</span>
                    )}
                  </span>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function PastChip({ w, active }: { w: SeriesWindow; active: boolean }) {
  const dir = windowOutcome(w)
  const isUp = dir === 'up'
  const color = isUp ? UP_GREEN : DOWN_RED
  return (
    <Link
      href={`/markets/${w.slug}`}
      title={`${format(new Date(w.closesAt), 'HH:mm')} · ${isUp ? 'Up' : 'Down'}`}
      className={`inline-flex flex-none items-center gap-1 rounded-pill border px-2 py-0.5 text-[11px] font-semibold tabular-nums transition-colors ${
        active ? 'border-transparent bg-surface-2' : 'border-hairline hover:bg-surface-2'
      }`}
      style={{ color }}
    >
      {isUp ? <IconArrowUp size={11} /> : <IconArrowDown size={11} />}
      {format(new Date(w.closesAt), 'HH:mm')}
    </Link>
  )
}

/* ---------- chart-type toggle button + icons ---------- */

function ChartToggle({
  active, onClick, label, children,
}: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-pill transition-colors ${
        active ? 'bg-surface-2 text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'
      }`}
    >
      {children}
    </button>
  )
}

function IconLineChart({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-4 4" />
    </svg>
  )
}

function IconBitcoin({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11.767 19.089c4.924.868 6.14-6.025 1.216-6.894m-1.216 6.894L5.86 18.047m5.908 1.042-.347 1.97m1.563-8.864c4.924.869 6.14-6.025 1.215-6.893m-1.215 6.893-3.94-.694m5.155-6.2L8.29 4.26m5.908 1.042.348-1.97M7.48 20.364l3.126-17.727" />
    </svg>
  )
}

function IconCandles({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 4v3M8 17v3" />
      <rect x="5.5" y="7" width="5" height="10" rx="1" />
      <path d="M16 2v4M16 15v5" />
      <rect x="13.5" y="6" width="5" height="9" rx="1" />
    </svg>
  )
}
