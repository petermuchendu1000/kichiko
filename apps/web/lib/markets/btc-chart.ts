// lib/markets/btc-chart.ts
// ---------------------------------------------------------------------------
// Pure, framework-free helpers for the recurring "Bitcoin Up or Down" chart.
//
// These functions were extracted out of components/markets/btc-live-chart.tsx
// so the probability model, the Coinbase candle granularity picker, the
// window-close / live-window selection, and the OHLC bucketing can all be unit
// tested in isolation (no React, no network, no DOM). The component imports
// them; the test suite (lib/__tests__/btc-chart.test.ts) exercises them.
//
// KEEP THIS FILE PURE: no imports from React / next / supabase, no I/O, no
// Date.now() reads inside the exported functions (callers pass `nowMs`). That
// is what makes the whole surface deterministic and cheap to test.
// ---------------------------------------------------------------------------

/** The three synchronized Polymarket-style chart views. */
export type ChartType = 'prob' | 'price' | 'candle'

/** A single spot sample on the shared time domain. */
export interface Pt {
  t: number
  price: number
}

/** One OHLC candle on the shared time domain (midpoint `t`). */
export interface Candle {
  t: number
  o: number
  h: number
  l: number
  c: number
}

/** Resolved direction of a window, normalised from `resolved_outcome`. */
export type WindowOutcome = 'up' | 'down' | null

/**
 * A sibling window in the same recurring series (5M / 15M / 30M / 1H). Carries
 * everything the navigator + live-window picker need. Times are ISO strings so
 * the shape maps 1:1 onto a Supabase row.
 */
export interface SeriesWindow {
  slug: string
  status: string
  closesAt: string
  windowSeconds: number
  label: string
  referencePrice?: number | null
  settlePrice?: number | null
  resolvedOutcome?: string | null
}

/**
 * Implied probability that spot finishes ABOVE the strike by window close —
 * logistic of the standardised move (spot − strike) / (σ·√timeLeft). σ is a
 * modest per-√second BTC vol; as timeLeft → 0 the denominator collapses so the
 * chance saturates to 0/1 based on the sign of the move. Clamped to [1, 99]%.
 *
 * The `2s` floor on the remaining time keeps the curve from hitting a hard
 * step exactly at the boundary (which reads as a glitch), while still
 * saturating hard in the final seconds — the same shape Polymarket traces.
 */
export function impliedUpProb(price: number, reference: number, remainingSec: number): number {
  if (!Number.isFinite(price) || !Number.isFinite(reference) || reference <= 0) return 50
  const secs = Math.max(remainingSec, 2)
  // ~0.045%/√s ≈ realistic short-horizon BTC vol; scale keeps the curve lively.
  const sigma = reference * 0.00045 * Math.sqrt(secs)
  const z = (price - reference) / (sigma || 1)
  const p = 1 / (1 + Math.exp(-z))
  return Math.min(99, Math.max(1, p * 100))
}

// Coinbase candles endpoint only accepts these granularities (seconds).
const COINBASE_GRANULARITIES = [60, 300, 900, 3600, 21600, 86400] as const
export type CoinbaseGranularity = (typeof COINBASE_GRANULARITIES)[number]

/**
 * Pick a Coinbase candle granularity for a window so the chart shows enough
 * real OHLC bars to be legible without being sparse. We aim for ~12–60 bars
 * across the visible window and snap to the nearest supported granularity that
 * does NOT exceed the window (so a 5M window never asks for a 1H candle).
 *
 * 5M  (300s)  → 60s  (~5 bars, plus the live sub-minute candle on top)
 * 15M (900s)  → 60s  (~15 bars)
 * 30M (1800s) → 60s  (~30 bars)
 * 1H  (3600s) → 60s  (~60 bars)
 * larger      → the coarsest granularity that keeps ≥ ~24 bars.
 */
export function pickGranularity(windowSeconds: number): CoinbaseGranularity {
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return 60
  // Target roughly this many candles across the window.
  const TARGET = 30
  const ideal = windowSeconds / TARGET
  // Largest supported granularity that is ≤ ideal, but never larger than the
  // window itself, and never coarser than 1/4 of the window (keeps ≥ 4 bars).
  const maxAllowed = Math.max(60, windowSeconds / 4)
  let chosen: CoinbaseGranularity = 60
  for (const g of COINBASE_GRANULARITIES) {
    if (g <= ideal && g <= maxAllowed) chosen = g
  }
  return chosen
}

/**
 * Rolling time-weighted average price.
 *
 * WHY THE LINE LOOKED LIKE STAIRS. We plotted last-trade price. A tape is a
 * step function: measured on Coinbase BTC-USD, 1000 prints over 310 seconds
 * carried 44 distinct prices, with ten-second slices ranging one cent and then
 * a $16.76 jump. Dozens of prints peck the same resting order, then the book
 * moves. No amount of axis or padding work makes that curve.
 *
 * Polymarket's BTC Up-or-Down chart is smooth because it is not plotting a
 * tape. Captured from their live market socket, topic
 * `crypto_prices_twap_sixty`, one message per second:
 *
 *   81502.81476676697  81502.88702075426  81502.95926986705  81503.02960677713
 *
 * Steps of about seven hundredths of a dollar. That is a sixty-second TWAP,
 * and their rules confirm it — the market resolves on Chainlink's
 * `btc-usd-twap-60s` stream, "not according to any other sources or spot
 * markets". A rolling mean cannot jump: each new sample moves it by
 * (new - oldest) / window.
 *
 * So this computes the same quantity from the prints we already hold. The
 * series is treated as a step function (a price holds until the next print),
 * integrated over the trailing window, and emitted on a fixed cadence. Early
 * in a window the lookback is shorter than `windowMs`; it averages over what
 * exists rather than inventing history, which is why the first seconds move
 * faster — the same behaviour their feed shows.
 */
export function twapSeries(points: Pt[], windowMs = 60_000, stepMs = 1000): Pt[] {
  if (points.length === 0) return []
  const t0 = points[0].t
  const tN = points[points.length - 1].t
  if (tN <= t0) return [{ t: tN, price: points[points.length - 1].price }]

  // Cumulative integral of the step function at each sample.
  const cum = new Array<number>(points.length).fill(0)
  for (let i = 1; i < points.length; i += 1) {
    cum[i] = cum[i - 1] + points[i - 1].price * (points[i].t - points[i - 1].t)
  }

  const integralTo = (t: number): number => {
    if (t <= t0) return 0
    if (t >= tN) return cum[cum.length - 1] + points[points.length - 1].price * (t - tN)
    let lo = 0
    let hi = points.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (points[mid].t <= t) lo = mid
      else hi = mid
    }
    return cum[lo] + points[lo].price * (t - points[lo].t)
  }

  const at = (t: number): Pt => {
    const a = Math.max(t0, t - windowMs)
    const span = t - a
    return { t, price: span <= 0 ? points[0].price : (integralTo(t) - integralTo(a)) / span }
  }

  const out: Pt[] = []
  for (let t = t0; t <= tN; t += stepMs) out.push(at(t))
  // Always finish on the freshest sample, so the live endpoint is the live
  // endpoint and not up to a step stale.
  if (out.length === 0 || out[out.length - 1].t < tN) out.push(at(tN))
  return out
}

/**
 * Thin a series to at most `max` samples, keeping the first and the last.
 *
 * Coinbase's trade feed hands back a thousand prints for a five-minute window.
 * That is the right history to have and the wrong number of SVG points to draw
 * on a 1400px plot, so stride it. Endpoints are kept because the first sample
 * anchors the window open and the last is the live price.
 */
export function downsamplePoints(points: Pt[], max = 600): Pt[] {
  if (max < 2 || points.length <= max) return points
  const stride = (points.length - 1) / (max - 1)
  const out: Pt[] = []
  for (let i = 0; i < max; i += 1) out.push(points[Math.round(i * stride)])
  return out
}

/** Candles that say something: a bar with no range at all is a flat dash. */
export function informativeCandles(cs: Candle[]): number {
  return cs.reduce((n, c) => (c.h > c.l ? n + 1 : n), 0)
}

/**
 * Which of the two candle sources to draw.
 *
 * 60 seconds is the finest bar Coinbase publishes, so a 5-minute window gets
 * five of them. Measured live, that drew one block a quarter of the plot wide
 * and two hairlines beside it: a bar chart with five bars, not a candlestick
 * chart. Polymarket shows dozens on the same window because theirs come from
 * their own tick feed, which this app does not have. Bucketing our live spot
 * series into 44 candles gives the short windows the resolution they need.
 *
 * But the first attempt at this decided on the window LENGTH, and a window
 * that closed while the chart was open showed why that is wrong: nobody was
 * collecting ticks, so bucketing had only five minute-closes to work with and
 * drew five zero-height dashes, having discarded the five real OHLC bars that
 * were the best data available. The length of the window says nothing about
 * how much live data we happen to hold.
 *
 * So decide on the thing that actually matters — whether the bucketed series
 * has enough bars with a real high-low range to be worth looking at. A past
 * window, or one opened seconds ago, falls back to the real bars; a window
 * that has been watched for a couple of minutes uses its own denser ticks.
 */
export function pickCandleSource(
  real: Candle[],
  bucketed: Candle[],
  minInformative = 12,
): 'real' | 'bucketed' {
  if (real.length === 0) return 'bucketed'
  return informativeCandles(bucketed) >= minInformative ? 'bucketed' : 'real'
}

/**
 * A window is "closed" for UI purposes when the server has already moved it off
 * `active`, OR the wall clock has reached its close time (client-side detection
 * so the chart + ticket freeze the instant a window ends, with no refresh).
 */
export function isWindowClosed(status: string | undefined, closeMs: number, nowMs: number): boolean {
  return (status ?? 'active') !== 'active' || nowMs >= closeMs
}

/** Normalise a stored `resolved_outcome` ('yes'|'no') to an Up/Down direction. */
export function outcomeOf(resolvedOutcome: string | null | undefined): WindowOutcome {
  if (resolvedOutcome === 'yes') return 'up'
  if (resolvedOutcome === 'no') return 'down'
  return null
}

/**
 * Derive an Up/Down outcome from settle vs reference price when the stored
 * `resolved_outcome` is missing (defensive — the oracle should always set it).
 *
 * STRICTLY greater, because that is what actually pays. resolve_btc_windows()
 * settles on `v_settle > v_w.reference_price`, and the market's own rules text
 * says so in as many words: "A flat price settles NO." This function used to
 * use `>=` while its comment claimed to match the settlement rule, so an exact
 * tie would have been drawn as Up on the chart and paid as Down in the ledger.
 * A tie is unlikely on a TWAP carried to twelve decimal places, but "unlikely"
 * is not a reason for the chart and the payout to disagree.
 *
 * Note this is the one place Kichiko deliberately differs from Polymarket,
 * whose BTC Up/Down resolves ties UP ("greater than or equal to the price at
 * the beginning of that range"). Matching them is a product decision about who
 * wins a flat window, not a rendering detail, so it is not made here.
 */
export function outcomeFromPrices(referencePrice?: number | null, settlePrice?: number | null): WindowOutcome {
  if (referencePrice == null || settlePrice == null) return null
  if (!Number.isFinite(referencePrice) || !Number.isFinite(settlePrice)) return null
  return settlePrice > referencePrice ? 'up' : 'down'
}

/** Best-available outcome: prefer the stored flag, fall back to price compare. */
export function windowOutcome(w: Pick<SeriesWindow, 'resolvedOutcome' | 'referencePrice' | 'settlePrice'>): WindowOutcome {
  return outcomeOf(w.resolvedOutcome) ?? outcomeFromPrices(w.referencePrice, w.settlePrice)
}

/**
 * Pick the current LIVE window from a series: the active window whose close
 * time is still in the future, choosing the soonest-closing one (so a freshly
 * opened successor is preferred the moment the previous window ends). Returns
 * null when the series has no live window yet.
 */
export function pickLiveWindow(windows: SeriesWindow[], nowMs: number): SeriesWindow | null {
  const live = windows
    .filter((w) => w.status === 'active' && new Date(w.closesAt).getTime() > nowMs)
    .sort((a, b) => new Date(a.closesAt).getTime() - new Date(b.closesAt).getTime())
  return live[0] ?? null
}

/**
 * The successor to a just-closed window: the live window in the SAME series
 * whose window length matches, i.e. the next 5M/15M/… window a trader should be
 * bumped to. Falls back to any live window in the series when no exact-length
 * match exists.
 */
export function pickSuccessorWindow(
  windows: SeriesWindow[],
  closedWindowSeconds: number,
  nowMs: number,
): SeriesWindow | null {
  const live = windows
    .filter((w) => w.status === 'active' && new Date(w.closesAt).getTime() > nowMs)
    .sort((a, b) => new Date(a.closesAt).getTime() - new Date(b.closesAt).getTime())
  return live.find((w) => w.windowSeconds === closedWindowSeconds) ?? live[0] ?? null
}

/**
 * Recent RESOLVED windows for the "Past ▾" navigator, newest first, capped to
 * `limit`. Only windows carrying a usable outcome are returned so every chip
 * can render a colored Up/Down indicator.
 */
export function pastWindows(windows: SeriesWindow[], limit = 8): SeriesWindow[] {
  return windows
    .filter((w) => w.status === 'resolved' && windowOutcome(w) != null)
    .sort((a, b) => new Date(b.closesAt).getTime() - new Date(a.closesAt).getTime())
    .slice(0, limit)
}

/**
 * The window's time range, the way Polymarket writes it under the title:
 * "October 17, 2:35-2:40PM ET".
 *
 * Captured from their BTC 5m page, which renders it at 16px/500 in the
 * secondary text colour directly beneath the h1. The meridiem appears once
 * when both ends share it ("2:35-2:40PM") and twice when they do not
 * ("11:55AM-12:00PM"), which is the only part of the format that is not
 * obvious. The zone abbreviation is appended so the range is unambiguous —
 * theirs is always ET because that is the only clock their market speaks; ours
 * is the viewer's, so it has to be named rather than assumed.
 *
 * This only reads as a range because the windows sit on the wall clock
 * (migration 128). Before that the honest rendering of a 5M window was
 * "2:59:33-3:04:33", which is why there was nothing to print.
 *
 * Pure: the caller supplies both instants and the zone, so it is deterministic
 * and testable, and the component can defer it to the client where the real
 * timezone is known.
 */
export function formatWindowRange(openMs: number, closeMs: number, timeZone?: string): string {
  if (!Number.isFinite(openMs) || !Number.isFinite(closeMs)) return ''
  const open = new Date(openMs)
  const close = new Date(closeMs)

  const opts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true }
  if (timeZone) opts.timeZone = timeZone

  // en-US gives "2:35 PM"; split the meridiem off so it can be shown once.
  const split = (d: Date): { time: string; meridiem: string } => {
    const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(d)
    const time = parts
      .filter((p) => p.type === 'hour' || p.type === 'literal' || p.type === 'minute')
      .map((p) => p.value)
      .join('')
      .trim()
    const meridiem = (parts.find((p) => p.type === 'dayPeriod')?.value ?? '').toUpperCase()
    return { time, meridiem }
  }

  const a = split(open)
  const b = split(close)

  const dateOpts: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' }
  if (timeZone) dateOpts.timeZone = timeZone
  const day = new Intl.DateTimeFormat('en-US', dateOpts).format(open)

  const zoneOpts: Intl.DateTimeFormatOptions = { timeZoneName: 'short' }
  if (timeZone) zoneOpts.timeZone = timeZone
  const zone =
    new Intl.DateTimeFormat('en-US', zoneOpts).formatToParts(open).find((p) => p.type === 'timeZoneName')?.value ?? ''

  const range =
    a.meridiem === b.meridiem
      ? `${a.time}-${b.time}${b.meridiem}`
      : `${a.time}${a.meridiem}-${b.time}${b.meridiem}`

  return zone ? `${day}, ${range} ${zone}` : `${day}, ${range}`
}

/** Candle bucket width (ms) so a window renders ~`targetCount` OHLC bars. */
export function candleBucketMs(openMs: number, closeMs: number, targetCount = 44): number {
  const span = Math.max(1, closeMs - openMs)
  return Math.max(4000, Math.round(span / Math.max(1, targetCount)))
}

/**
 * Bucket a spot series into OHLC candles — the fallback renderer used when real
 * Coinbase OHLC candles are unavailable (CORS/region). Deterministic given the
 * inputs. Buckets are half-open [start, start+width); the candle `t` is the
 * bucket midpoint so it centers under the shared time axis.
 */
export function bucketCandles(points: Pt[], openMs: number, closeMs: number, targetCount = 44): Candle[] {
  if (points.length === 0) return []
  const width = candleBucketMs(openMs, closeMs, targetCount)
  const byBucket = new Map<number, Pt[]>()
  for (const p of points) {
    const b = Math.floor((p.t - openMs) / width)
    const arr = byBucket.get(b)
    if (arr) arr.push(p)
    else byBucket.set(b, [p])
  }
  return Array.from(byBucket.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([b, pts]) => {
      const ps = pts.map((x) => x.price)
      return {
        t: openMs + b * width + width / 2,
        o: pts[0].price,
        c: pts[pts.length - 1].price,
        h: Math.max(...ps),
        l: Math.min(...ps),
      }
    })
}

/**
 * Merge real Coinbase OHLC candles (authoritative history) with a single live
 * in-progress candle built from the freshest spot samples, so the tail of the
 * chart keeps moving between the 1-minute Coinbase bars. `realCandles` must be
 * sorted ascending by `t`. Any live points at/after the last real candle's
 * bucket are folded into one trailing candle.
 */
export function mergeLiveCandle(realCandles: Candle[], livePoints: Pt[], granularitySec: number): Candle[] {
  if (realCandles.length === 0) return realCandles
  const gMs = granularitySec * 1000
  const lastReal = realCandles[realCandles.length - 1]
  // Start of the bucket AFTER the last real candle's bucket.
  const liveBucketStart = lastReal.t + gMs
  const fresh = livePoints.filter((p) => p.t >= liveBucketStart)
  if (fresh.length === 0) return realCandles
  const ps = fresh.map((p) => p.price)
  const live: Candle = {
    t: liveBucketStart + gMs / 2,
    o: fresh[0].price,
    c: fresh[fresh.length - 1].price,
    h: Math.max(...ps),
    l: Math.min(...ps),
  }
  return [...realCandles, live]
}

/* ---------- axis ticks ---------- */

/**
 * Round tick VALUES for a value axis, and the precision they need.
 *
 * Two defects, one cause. Left to itself on a zoomed domain recharts printed
 * 52 / 52 / 51 / 50 / 50 — two pairs of identical labels, which reads as a
 * broken chart rather than as a quiet market. Giving the formatter a decimal
 * made them distinct and then showed the real problem: 45.7 / 47.7 / 50.5,
 * three labels with different gaps between them, because the values were
 * wherever the padded domain's ends happened to fall.
 *
 * Polymarket's axis reads 38 / 40 / 42 / 44: round numbers, evenly spaced,
 * independent of where the data starts. So choose the step, put the ticks on
 * its multiples, and let the step say how many decimals the label needs — a
 * step of 2 never needs one, a step of 0.5 always does. Ticks outside the
 * domain are simply not emitted, so the plot keeps the tight range the
 * padding gives it.
 *
 * The step set is 1, 2 and 5 times a power of ten, and deliberately NOT the
 * 2.5 that usually joins them: a 0.25 step puts a tick on 49.75, which one
 * decimal renders as "49.8" — a label that is not the value it marks. Every
 * step here is exact at the precision its own magnitude implies.
 */
export function niceTicks(lo: number, hi: number, target = 5): { ticks: number[]; dp: number } {
  // A very quiet window can be two or three dollars tall, where the first
  // round step that fits yields only two labels and the axis stops saying
  // much. Ask for a denser target before settling, which drops the step to
  // the next size down (1 -> 0.5) rather than leaving the gap unmarked.
  for (const t of [target, target + 3, target + 6]) {
    const got = buildTicks(lo, hi, t)
    if (got.ticks.length >= 3) return got
  }
  return buildTicks(lo, hi, target)
}

function buildTicks(lo: number, hi: number, target: number): { ticks: number[]; dp: number } {
  const span = hi - lo
  if (!Number.isFinite(span) || span <= 0) return { ticks: [], dp: 0 }
  const raw = span / Math.max(2, target - 1)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((v) => v >= raw) ?? 10 * mag
  // Exactly the decimals the step needs: 5 -> 0, 0.5 -> 1, 0.05 -> 2. The
  // epsilon keeps log10(0.1) = 1.0000000000000002 from asking for two.
  const dp = Math.max(0, Math.min(4, Math.ceil(-Math.log10(step) - 1e-9)))
  const ticks: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
    ticks.push(Number(v.toFixed(6)))
  }
  return { ticks, dp }
}

const TICK_STEPS_MS = [
  15_000, 30_000, 60_000, 120_000, 300_000, 600_000,
  900_000, 1_800_000, 3_600_000, 7_200_000, 21_600_000,
]

/**
 * Round time ticks, instead of whatever the domain's ends happen to be.
 *
 * The right edge tracks `now`, so recharts' automatic ticks closed the axis on
 * 05:39:03 — a time with no meaning, sitting beside clean minute marks. Choose
 * a step that suits the window and lay ticks on it. The caller formats with
 * seconds only when the step is finer than a minute, which is what keeps
 * Polymarket's short-window axis readable and ours from printing ":00" five
 * times.
 */
export function timeTicks(fromMs: number, toMs: number): { ticks: number[]; stepMs: number } {
  const span = Math.max(0, toMs - fromMs)
  const stepMs = TICK_STEPS_MS.find((s) => span / s <= 6) ?? TICK_STEPS_MS[TICK_STEPS_MS.length - 1]
  const ticks: number[] = []
  for (let t = Math.ceil(fromMs / stepMs) * stepMs; t <= toMs; t += stepMs) ticks.push(t)
  return { ticks, stepMs }
}
