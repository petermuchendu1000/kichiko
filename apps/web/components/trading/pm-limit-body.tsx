'use client'

// components/trading/pm-limit-body.tsx
// ---------------------------------------------------------------------------
// The limit-order inputs, lifted out of pm-ticket.tsx so they can be loaded
// when someone actually switches to a limit order.
//
// The ticket renders this only under `orderType === 'limit'`, and the default
// is a market order, so for most visits it is code that is downloaded and
// never run — on /markets/[slug], the route A11 is still over budget on.
// Lifting it changes no behaviour: same props, same markup.
import { useEffect } from 'react'
import { clampLimitCents } from '@/lib/trading'
import { formatCurrency, usdToLocal, type RatesMap } from '@/lib/currency'
import { formatCents } from '@/lib/clob'
import type { CurrencyCode } from '@/types'

export function PmLimitBody({
  limitCents,
  setLimitCents,
  shares,
  setShares,
  currentCents,
  preferredCurrency,
  rates,
  onError,
}: {
  limitCents: string
  setLimitCents: (v: string) => void
  shares: string
  setShares: (v: string) => void
  currentCents: number
  preferredCurrency: CurrencyCode
  rates: RatesMap
  onError: () => void
}) {
  // Seed the limit price with the live market price on first entry (PM default).
  useEffect(() => {
    if (!limitCents && currentCents > 0) setLimitCents(String(currentCents))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clampCents = (n: number) => Math.min(99.9, Math.max(0.1, Math.round(n * 10) / 10))
  const centsVal = parseFloat(limitCents) || 0
  const sharesNum = Math.max(0, parseInt(shares || '0', 10) || 0)
  const step = (delta: number) => {
    setLimitCents(String(clampCents((parseFloat(limitCents) || currentCents || 0) + delta)))
    onError()
  }
  const bump = (delta: number) => {
    setShares(String(Math.max(0, sharesNum + delta)))
    onError()
  }
  // A share costs (price¢ / 100) USD and pays $1 (100¢) if it wins — the same
  // unit model as the market body and the CLOB engine. Convert both USD figures
  // to the display currency; rendering the raw USD amounts as local (the prior
  // bug) understated cost and payout by the FX rate (~100× for KES).
  const totalLocal = usdToLocal(sharesNum * (centsVal / 100), preferredCurrency, rates)
  const toWinLocal = usdToLocal(sharesNum * 1, preferredCurrency, rates)

  const shareChip =
    'flex h-[30px] items-center justify-center rounded-[9px] border px-2.5 text-xs font-semibold tracking-[-0.1px] transition-colors'

  return (
    <div className="flex flex-col gap-4 pt-1">
      {/* Limit price */}
      <div className="flex items-center justify-between">
        <span className="text-base font-medium text-text-primary">Limit price</span>
        <div className="flex h-10 w-[150px] items-center justify-between rounded-[9px] border border-hairline px-2">
          <button
            type="button"
            aria-label="Decrease limit price"
            onClick={() => step(-0.1)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-primary transition-colors hover:bg-[color:var(--surface-2)]"
          >
            −
          </button>
          <div className="flex items-baseline">
            <input
              inputMode="decimal"
              aria-label="Limit price in percent"
              value={limitCents}
              onChange={(e) => { setLimitCents(e.target.value.replace(/[^0-9.]/g, '').slice(0, 4)); onError() }}
              placeholder="0.0"
              size={4}
              className="w-[42px] bg-transparent text-center text-[18px] font-semibold tabular-nums text-text-primary outline-none placeholder:text-ink-300"
            />
            <span className="text-[18px] font-semibold text-text-primary">%</span>
          </div>
          <button
            type="button"
            aria-label="Increase limit price"
            onClick={() => step(0.1)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-primary transition-colors hover:bg-[color:var(--surface-2)]"
          >
            +
          </button>
        </div>
      </div>

      <div className="h-px w-full bg-hairline" />

      {/* Shares */}
      <div className="flex items-center justify-between">
        <span className="text-base font-medium text-text-primary">Shares</span>
        <div className="flex h-10 w-[150px] items-center rounded-[9px] border border-hairline px-3">
          <input
            inputMode="numeric"
            aria-label="Number of shares"
            value={shares}
            onChange={(e) => { setShares(e.target.value.replace(/[^0-9]/g, '')); onError() }}
            placeholder="0"
            className="w-full bg-transparent text-right text-[18px] font-semibold tabular-nums text-text-primary outline-none placeholder:text-ink-300"
          />
        </div>
      </div>

      {/* Shares quick-adds (right-aligned) — last (+200) is accented per PM */}
      <div className="flex items-center justify-end gap-1">
        {[-100, -10, 10, 100, 200].map((d, i) => {
          const accent = i === 4
          return (
            <button
              key={d}
              type="button"
              onClick={() => bump(d)}
              className={`${shareChip} ${
                accent
                  ? 'border-pip-500 text-pip-500 hover:bg-pip-100'
                  : 'border-hairline text-text-muted hover:bg-[color:var(--surface-2)]'
              }`}
            >
              {d > 0 ? `+${d}` : d}
            </button>
          )
        })}
      </div>

      {/* Matching indicator */}
      <div className="flex min-h-[16px] justify-end">
        {sharesNum > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--yes-tint)] px-2 py-0.5 text-xs font-semibold text-[#42C772]">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
              <circle cx="6" cy="6" r="5" />
              <line x1="6" y1="5.5" x2="6" y2="8.5" />
              <circle cx="6" cy="3.6" r="0.6" fill="currentColor" stroke="none" />
            </svg>
            {sharesNum.toFixed(2)} matching
          </span>
        )}
      </div>

      <div className="h-px w-full bg-hairline" />

      {/* Expires */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-muted">Expires</span>
        <button type="button" className="flex items-center gap-1 text-sm font-medium text-ink-300 transition-colors hover:text-text-secondary">
          Never
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3.5 5.25 7 8.75l3.5-3.5" />
          </svg>
        </button>
      </div>

      {/* Total */}
      <div className="flex items-center justify-between">
        <span className="text-base font-medium text-text-primary">Total</span>
        <span className="text-[18px] font-medium tabular-nums text-[#1452F0]">
          {formatCurrency(totalLocal, preferredCurrency)}
        </span>
      </div>

      {/* To win */}
      <div className="flex items-center justify-between">
        <span className="text-base font-medium text-text-primary">To win</span>
        <span className="text-[24px] font-medium tabular-nums text-[#30A159]">
          {formatCurrency(toWinLocal, preferredCurrency)}
        </span>
      </div>
    </div>
  )
}
