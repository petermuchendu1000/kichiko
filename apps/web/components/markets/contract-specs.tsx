/**
 * ContractSpecs — Kichiko
 * Mobile market-detail "Market details" key/value grid (Polymarket parity).
 * Pure presentational, server-safe component (no hooks / no 'use client').
 * Renders Volume, End Date, optional Market Opened, and a Resolver row.
 */

import { format } from 'date-fns'
import { formatUSD } from '@/lib/utils'
import { IconInfo, IconExternalLink } from '@/components/ui/icons'
import { TraderNameLink } from '@/components/ui/trader-link'

/** Safely derive a display host from a URL, falling back to a generic label. */
function resolverHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return 'Resolution source'
  }
}

/** Safely format an ISO date string; returns null when unparseable. */
function safeFormat(iso: string, pattern: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return format(date, pattern)
}

export function ContractSpecs(props: {
  volumeUsd: number
  endDate: string // ISO close date
  openedAt?: string | null // ISO created_at
  resolutionSource?: string | null // URL
  createdBy?: string | null // author display name
  createdById?: string | null // author user id (makes the name clickable)
  className?: string
}) {
  const { volumeUsd, endDate, openedAt, resolutionSource, createdBy, createdById, className } = props

  const endLabel = safeFormat(endDate, 'MMM d, yyyy') ?? endDate
  const openedLabel = openedAt ? safeFormat(openedAt, 'MMM d, yyyy, h:mm a') : null

  const hasResolverLink =
    typeof resolutionSource === 'string' && resolutionSource.trim().length > 0

  return (
    <section
      aria-label="Market details"
      className={['card w-full p-4', className].filter(Boolean).join(' ')}
    >
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-primary">
        <IconInfo size={16} className="shrink-0 text-text-secondary" />
        Market details
      </h2>

      <dl className="divide-y divide-hairline">
        <div className="flex items-center justify-between gap-4 py-2 text-sm">
          <dt className="text-text-muted">Volume</dt>
          <dd className="min-w-0 truncate text-right font-medium text-text-primary">
            {formatUSD(volumeUsd)}
          </dd>
        </div>

        <div className="flex items-center justify-between gap-4 py-2 text-sm">
          <dt className="text-text-muted">End Date</dt>
          <dd className="min-w-0 truncate text-right font-medium text-text-primary">{endLabel}</dd>
        </div>

        {openedLabel ? (
          <div className="flex items-center justify-between gap-4 py-2 text-sm">
            <dt className="text-text-muted">Market Opened</dt>
            <dd className="min-w-0 truncate text-right font-medium text-text-primary">
              {openedLabel}
            </dd>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-4 py-2 text-sm">
          <dt className="text-text-muted">Resolver</dt>
          <dd className="min-w-0 text-right font-medium text-text-primary">
            {hasResolverLink ? (
              <a
                href={resolutionSource as string}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex max-w-full items-center justify-end gap-1 truncate hover:underline"
              >
                <span className="truncate">{resolverHost(resolutionSource as string)}</span>
                <IconExternalLink size={14} className="shrink-0" />
              </a>
            ) : createdBy && createdBy.trim().length > 0 ? (
              createdById ? (
                <TraderNameLink id={createdById} name={createdBy} className="max-w-full" />
              ) : (
                <span className="truncate">{createdBy}</span>
              )
            ) : (
              <span className="truncate">Kichiko oracle</span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  )
}
