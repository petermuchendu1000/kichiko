// lib/format.ts — centralized locale + timezone aware formatters (Module 17.3).
//
// Replaces ad-hoc `toLocaleString()` / hand-rolled date strings scattered across
// the app. Money formatting continues to defer to `CURRENCY_META` locales via
// `formatCurrency` (lib/currency.ts); this module covers dates, times, numbers,
// percentages and compact/relative values consistently. Pure + unit-tested.
import { DEFAULT_LOCALE, LOCALE_TIMEZONE, resolveLocale, type AppLocale } from '@/i18n/config'

function tzFor(locale: AppLocale): string {
  return LOCALE_TIMEZONE[locale] ?? 'Africa/Nairobi'
}

/** Absolute date, e.g. "3 Jul 2026". */
export function formatDate(
  value: Date | string | number,
  locale: string = DEFAULT_LOCALE,
  options?: Intl.DateTimeFormatOptions
): string {
  const loc = resolveLocale(locale)
  const d = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(loc, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: tzFor(loc),
    ...options,
  }).format(d)
}

/** Date + time in the locale's East-Africa timezone, e.g. "3 Jul 2026, 13:05". */
export function formatDateTime(
  value: Date | string | number,
  locale: string = DEFAULT_LOCALE
): string {
  return formatDate(value, locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Plain number with grouping, e.g. "8,200". */
export function formatNumber(
  value: number,
  locale: string = DEFAULT_LOCALE,
  options?: Intl.NumberFormatOptions
): string {
  return new Intl.NumberFormat(resolveLocale(locale), options).format(value)
}

/** Percentage from a 0..1 ratio, e.g. 0.62 -> "62%". */
export function formatPercent(
  ratio: number,
  locale: string = DEFAULT_LOCALE,
  fractionDigits = 0
): string {
  return new Intl.NumberFormat(resolveLocale(locale), {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(ratio)
}

/**
 * A probability for display: whole-number percent from a 0..1 ratio, with honest
 * edges so a 0.4% longshot never reads "0%" and 99.6% never reads "100%"
 * (work plan v2, rule PR-1). Use this for every displayed chance.
 */
export function formatProbability(ratio: number, locale: string = DEFAULT_LOCALE): string {
  const v = ratio * 100
  if (v > 0 && v < 1) return '<1%'
  if (v > 99 && v < 100) return '>99%'
  return formatPercent(Math.round(v) / 100, locale)
}

/** Compact large numbers, e.g. 2_400_000 -> "2.4M". */
export function formatCompact(value: number, locale: string = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(resolveLocale(locale), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

/** Relative time, e.g. "in 3 days" / "2 hours ago". */
export function formatRelativeTime(
  value: Date | string | number,
  locale: string = DEFAULT_LOCALE,
  base: Date = new Date()
): string {
  const loc = resolveLocale(locale)
  const d = value instanceof Date ? value : new Date(value)
  const diffSec = Math.round((d.getTime() - base.getTime()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' })
  const abs = Math.abs(diffSec)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ]
  for (const [unit, secs] of units) {
    if (abs >= secs || unit === 'second') {
      return rtf.format(Math.round(diffSec / secs), unit)
    }
  }
  return rtf.format(0, 'second')
}
