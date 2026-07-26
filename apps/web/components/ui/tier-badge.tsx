'use client'

// components/ui/tier-badge.tsx
// ------------------------------------------------------------
// Kichiko trader-tier medal. Original medal artwork (rounded shield with a
// beveled highlight + chevron emblem) tinted per tier via lib/tier.ts. Used as
// the corner badge on trader avatars and as an inline chip next to a name.
// The badge encodes the tier in its accessible label (e.g. "Gold tier").
import { useId } from 'react'
import { type Tier, type TierKey, tierByKey } from '@/lib/tier'

interface TierBadgeProps {
  tier: Tier | TierKey
  /** Rendered diameter in px. */
  size?: number
  className?: string
  /** Ring colour (to lift the medal off a busy avatar). Defaults to surface. */
  ring?: string
}

export function TierBadge({ tier, size = 20, className = '', ring }: TierBadgeProps) {
  const t = typeof tier === 'string' ? tierByKey(tier) : tier
  const uid = useId().replace(/:/g, '')
  const [from, to] = t.gradient
  return (
    <span
      className={`relative inline-flex flex-none items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${t.label} tier`}
      title={`${t.label} tier`}
    >
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id={`tb-${uid}`} x1="8" y1="2" x2="32" y2="38" gradientUnits="userSpaceOnUse">
            <stop stopColor={from} />
            <stop offset="1" stopColor={to} />
          </linearGradient>
          <linearGradient id={`tb-hi-${uid}`} x1="20" y1="3" x2="20" y2="20" gradientUnits="userSpaceOnUse">
            <stop stopColor="#ffffff" stopOpacity="0.45" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Optional contrast ring */}
        {ring && <circle cx="20" cy="20" r="19.2" fill={ring} />}
        {/* Rounded-shield medal (Kichiko original shape) */}
        <path
          d="M20 2.5c1.2 0 2.36.29 3.4.83l9.1 4.7A5.5 5.5 0 0 1 35.5 12.9v8.7c0 5.9-3.3 11.3-8.6 14.1l-5.3 2.8a3.5 3.5 0 0 1-3.2 0l-5.3-2.8A16 16 0 0 1 4.5 21.6v-8.7c0-2.06 1.15-3.95 2.98-4.9l9.12-4.7A7.5 7.5 0 0 1 20 2.5Z"
          fill={`url(#tb-${uid})`}
        />
        {/* Bevel highlight */}
        <path
          d="M20 2.5c1.2 0 2.36.29 3.4.83l9.1 4.7A5.5 5.5 0 0 1 35.5 12.9v3.2c0-2.06-1.15-3.95-2.98-4.9l-9.12-4.7A7.5 7.5 0 0 0 20 5.7a7.5 7.5 0 0 0-3.4.83l-9.12 4.7A5.5 5.5 0 0 0 4.5 16.1v-3.2c0-2.06 1.15-3.95 2.98-4.9l9.12-4.7A7.5 7.5 0 0 1 20 2.5Z"
          fill={`url(#tb-hi-${uid})`}
        />
        {/* Chevron emblem */}
        <path
          d="M13.5 19.5 20 13l6.5 6.5M13.5 26 20 19.5l6.5 6.5"
          stroke={t.ink}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.92"
        />
      </svg>
    </span>
  )
}

/** Inline pill: medal + tier name. */
export function TierChip({ tier, className = '' }: { tier: Tier | TierKey; className?: string }) {
  const t = typeof tier === 'string' ? tierByKey(tier) : tier
  if (t.key === 'none') return null
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill py-0.5 pl-0.5 pr-2 text-xs font-semibold ${className}`}
      style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
    >
      <TierBadge tier={t} size={16} />
      {t.label}
    </span>
  )
}
