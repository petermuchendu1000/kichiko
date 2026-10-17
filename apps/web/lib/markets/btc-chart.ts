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
 * UP iff settle ≥ reference, matching the settlement rule.
 */
export function outcomeFromPrices(referencePrice?: number | null, settlePrice?: number | null): WindowOutcome {
  if (referencePrice == null || settlePrice == null) return null
  if (!Number.isFinite(referencePrice) || !Number.isFinite(settlePrice)) return null
  return settlePrice >= referencePrice ? 'up' : 'down'
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
