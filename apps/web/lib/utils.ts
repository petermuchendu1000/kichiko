// lib/utils.ts
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { usdToLocal } from './currency'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(
  amount: number,
  currency: string,
  locale: string = 'en-KE'
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount.toLocaleString()} ${currency}`
  }
}

// Named for its historical USD role; the pilot displays Kenyan Shillings. All
// call sites pass USD-stored amounts, which this converts to KES for display.
export function formatUSD(amount: number): string {
  const kes = usdToLocal(amount || 0, 'KES')
  return `KSh ${Math.round(kes).toLocaleString('en-KE')}`
}

// Amounts are stored in USD; the pilot shows Kenyan Shillings, so this converts
// via the shared FX helper (falls back to the pegged KES rate).
export function formatVolume(usd: number): string {
  const kes = usdToLocal(usd || 0, 'KES')
  if (kes >= 1_000_000_000) return `KSh ${(kes / 1_000_000_000).toFixed(1)}B`
  if (kes >= 1_000_000) return `KSh ${(kes / 1_000_000).toFixed(1)}M`
  if (kes >= 1_000) return `KSh ${(kes / 1_000).toFixed(1)}K`
  return `KSh ${Math.round(kes)}`
}

// Compact KES money for space-constrained numerics (portfolio KPI cards,
// holding rows). Full precision below 100K; abbreviated K/M/B above so large
// balances can never overflow a narrow card. Returns the MAGNITUDE only — the
// caller owns the +/- sign so it stays consistent with signed displays. Pair
// with a title={formatUSD(value)} tooltip when exactness matters.
export function formatMoneyCompact(amount: number): string {
  const kes = Math.abs(usdToLocal(amount || 0, 'KES'))
  if (kes >= 1_000_000_000) return `KSh ${(kes / 1_000_000_000).toFixed(2)}B`
  if (kes >= 1_000_000) return `KSh ${(kes / 1_000_000).toFixed(2)}M`
  if (kes >= 100_000) return `KSh ${(kes / 1_000).toFixed(1)}K`
  return `KSh ${Math.round(kes).toLocaleString('en-KE')}`
}

export function formatPercent(value: number, decimals: number = 0): string {
  return `${(value * 100).toFixed(decimals)}%`
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str
  return str.slice(0, length).trimEnd() + '…'
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Generate a consistent avatar color from user ID
export function avatarColor(userId: string): string {
  const colors = [
    'bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-yellow-500',
    'bg-lime-500', 'bg-green-500', 'bg-emerald-500', 'bg-teal-500',
    'bg-cyan-500', 'bg-sky-500', 'bg-blue-500', 'bg-indigo-500',
    'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-pink-500',
  ]
  const idx = userId.charCodeAt(0) % colors.length
  return colors[idx]
}
