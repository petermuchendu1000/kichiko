'use client'

// components/portfolio/holdings-table.tsx
// Institutional-grade holdings book (IBKR-style): weight-ranked, monospace
// figures, color-coded P&L with explicit signs, and a per-row expand that
// reveals the position's mechanics. Real <table> semantics; horizontal scroll
// is contained so the page never scrolls sideways on narrow panels.
import { Fragment, useState } from 'react'
import Link from 'next/link'
import { formatUSD } from '@/lib/utils'
import { IconChevronDown, IconArrowRight } from '@/components/ui/icons'

export interface HoldingRow {
  id: string
  title: string
  slug: string
  /** 'option' for multiple_choice positions (label carried in optionLabel). */
  side: 'yes' | 'no' | 'option'
  /** Chosen option label for multiple_choice positions. */
  optionLabel?: string
  shares: number
  avgCost: number // entry price (0..1)
  livePrice: number // current mark (0..1)
  marketValue: number // USD
  invested: number // USD
  pnl: number // USD
  pnlPct: number // fraction
  weight: number // fraction of holdings value
  isSettled: boolean
  outcomeLabel: string
}

interface HoldingsTableProps {
  holdings: HoldingRow[]
}

const cents = (p: number) => `${Math.round(p * 100)}\u00A2`
const pnlClass = (n: number) => (n > 0 ? 'text-yes' : n < 0 ? 'text-no' : 'text-text-secondary')
const signedUSD = (n: number) => `${n >= 0 ? '+' : ''}${formatUSD(n)}`

export function HoldingsTable({ holdings }: HoldingsTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null)

  if (holdings.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm font-medium text-text-secondary">No holdings yet</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-text-muted">
          Positions you open appear here, marked to the live market price.
        </p>
        <Link href="/markets" className="btn btn-primary btn-sm mt-4 inline-flex">
          Browse markets <IconArrowRight size={14} />
        </Link>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-text-muted">
              <th scope="col" className="px-4 py-2.5 font-medium">Position</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Avg cost</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Live</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Mkt value</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Unrealized P&amp;L</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Weight</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => {
              const isOpen = expanded === h.id
              // Show the option chip only when it carries information the title
              // doesn't already. For binary-style markets the option label IS
              // the title, so rendering both duplicated the market name in the
              // Position cell. Yes/No positions always keep their colored badge.
              const optLabel = h.optionLabel?.trim()
              const showOptionChip =
                h.side === 'option' && !!optLabel && optLabel.toLowerCase() !== h.title.trim().toLowerCase()
              return (
                <Fragment key={h.id}>
                  <tr
                    className="cursor-pointer border-b border-hairline transition-colors hover:bg-surface-2"
                    onClick={() => setExpanded(isOpen ? null : h.id)}
                  >
                    <td className="max-w-[220px] px-4 py-3 sm:max-w-[340px] md:max-w-[440px]">
                      <div className="flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-label={isOpen ? 'Collapse position' : 'Expand position'}
                          className="flex-none text-text-muted transition-transform"
                          style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}
                          onClick={(e) => {
                            e.stopPropagation()
                            setExpanded(isOpen ? null : h.id)
                          }}
                        >
                          <IconChevronDown size={15} />
                        </button>
                        {h.side === 'option' ? (
                          showOptionChip && (
                            <span
                              className="badge badge-muted flex-none max-w-[9rem] truncate"
                              title={optLabel}
                            >
                              {optLabel}
                            </span>
                          )
                        ) : (
                          <span
                            className={`badge ${h.side === 'yes' ? 'badge-green' : 'badge-red'} flex-none`}
                          >
                            {h.side.toUpperCase()}
                          </span>
                        )}
                        <span className="min-w-0 flex-1 truncate font-medium text-text-primary" title={h.title}>
                          {h.title}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right font-mono text-text-secondary">{cents(h.avgCost)}</td>
                    <td className="px-3 py-3 text-right font-mono text-text-primary">{cents(h.livePrice)}</td>
                    <td className="px-3 py-3 text-right font-mono text-text-primary">{formatUSD(h.marketValue)}</td>
                    <td className={`px-3 py-3 text-right font-mono font-semibold ${pnlClass(h.pnl)}`}>
                      {signedUSD(h.pnl)}
                      <span className="ml-1 text-xs font-medium opacity-80">
                        ({h.pnl >= 0 ? '+' : ''}
                        {(h.pnlPct * 100).toFixed(1)}%)
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <div className="prob-bar h-1.5 w-14">
                          <div className="prob-bar-fill" style={{ width: `${Math.round(h.weight * 100)}%` }} />
                        </div>
                        <span className="w-9 text-right font-mono text-xs text-text-secondary">
                          {(h.weight * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="border-b border-hairline bg-surface-2">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                          <Detail label="Shares" value={h.shares.toFixed(2)} />
                          <Detail label="Invested" value={formatUSD(h.invested)} />
                          <Detail label="Entry price" value={cents(h.avgCost)} />
                          <Detail label="Status" value={h.outcomeLabel} />
                        </div>
                        <Link
                          href={`/markets/${h.slug}`}
                          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-pip-500 hover:underline"
                        >
                          Open market <IconArrowRight size={13} />
                        </Link>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="font-mono text-sm text-text-primary">{value}</dd>
    </div>
  )
}
