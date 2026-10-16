// lib/date-display.ts
// ---------------------------------------------------------------------------
// The handful of date shapes the market page renders, on `Intl.DateTimeFormat`
// instead of date-fns.
//
// WHY
// `date-fns/format` plus its formatter table is ~47 kB of original source, and
// the build's source maps put it inside /markets/[slug]'s first load — to
// render four fixed patterns ("MMM", "MMM d", "HH:mm", "MMM d, yyyy") that the
// platform has formatted natively for a decade. Measured 2026-10-16 while
// getting that route under budget (ruling A11).
//
// This is not a campaign against date-fns: it stays wherever its parsing and
// arithmetic earn their weight. It is removed from the routes where all it did
// was spell a month name.
//
// `Intl.DateTimeFormat` instances are cached, because constructing one is the
// expensive part and these are called per axis tick.

const cache = new Map<string, Intl.DateTimeFormat>()

function fmt(opts: Intl.DateTimeFormatOptions, locale = 'en-US'): Intl.DateTimeFormat {
  const key = locale + JSON.stringify(opts)
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, opts)
    cache.set(key, f)
  }
  return f
}

/** "Oct" — date-fns 'MMM'. */
export function monthShort(d: Date): string {
  return fmt({ month: 'short' }).format(d)
}

/** "Oct 16" — date-fns 'MMM d'. */
export function monthDay(d: Date): string {
  return fmt({ month: 'short', day: 'numeric' }).format(d)
}

/** "Oct 16, 2026" — date-fns 'MMM d, yyyy'. */
export function monthDayYear(d: Date): string {
  return fmt({ month: 'short', day: 'numeric', year: 'numeric' }).format(d)
}

/**
 * "14:05" — date-fns 'HH:mm'.
 *
 * `hourCycle: 'h23'` rather than `hour12: false`: the latter renders midnight
 * as "24:00" in several locales, which is why it is not simply the default.
 */
export function hourMinute(d: Date): string {
  return fmt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
}

/**
 * "3 days ago" — date-fns `formatDistanceToNow(d, { addSuffix: true })`, via
 * `Intl.RelativeTimeFormat`.
 *
 * Not identical: date-fns says "about 1 hour ago" where this says "1 hour
 * ago", and date-fns rounds "almost 2 years". The precision it adds is not
 * precision anyone acts on next to a market's close date.
 */
export function timeAgo(d: Date, now: Date = new Date()): string {
  const rtf = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
  const sec = Math.round((d.getTime() - now.getTime()) / 1000)
  const abs = Math.abs(sec)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ]
  for (const [unit, size] of units) {
    if (abs >= size) return rtf.format(Math.round(sec / size), unit)
  }
  return rtf.format(Math.round(sec), 'second')
}
