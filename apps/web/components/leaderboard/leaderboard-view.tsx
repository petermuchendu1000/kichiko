'use client'

// components/leaderboard/leaderboard-view.tsx
// ---------------------------------------------------------------------------
// Leaderboard — institutional league table (Pip system). Metric segmented
// control + period pills, a restrained top-3 podium and a monospaced standings
// table. Every trader is a link to their public profile (/traders/{id}); the
// current user's row is highlighted and their rank is surfaced. Backed by
// GET /api/leaderboard. No hardcoded rows — all figures come from the API.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { TraderAvatar } from '@/components/ui/trader-avatar'
import { TraderLink, traderHref } from '@/components/ui/trader-link'
import { tierForVolume } from '@/lib/tier'
import {
  LEADERBOARD_METRICS,
  LEADERBOARD_PERIODS,
  METRIC_META,
  displayName,
  formatUsd,
  formatSignedUsd,
  formatPct,
  type LeaderboardMetric,
  type LeaderboardPeriod,
  type LeaderboardEntry,
} from '@/lib/leaderboard'
import { IconTrophy, IconTrendUp } from '@/components/ui/icons'

const PERIOD_LABEL: Record<LeaderboardPeriod, string> = {
  all: 'All-time',
  month: 'This month',
  week: 'This week',
}

/** Primary metric value for the active metric (podium + emphasized column). */
function primaryValue(e: LeaderboardEntry, metric: LeaderboardMetric): string {
  if (metric === 'winrate') return formatPct(e.win_rate)
  if (metric === 'pnl') return formatSignedUsd(e.profit_loss_usd)
  return formatUsd(e.total_volume_usd)
}

/** Secondary supporting stat shown under the podium value. */
function secondaryLine(e: LeaderboardEntry, metric: LeaderboardMetric): string {
  if (metric === 'winrate') return `${(e.total_bets || 0).toLocaleString()} bets`
  if (metric === 'pnl') return `${formatUsd(e.total_volume_usd)} vol`
  return `${formatPct(e.win_rate)} win`
}

/** Segmented control (metric / period) — roving-focus tablist on the Pip track. */
function Segmented({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  ariaLabel: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const next = e.key === 'ArrowRight' ? (i + 1) % options.length : (i - 1 + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-pill border border-hairline p-1"
      style={{ background: 'var(--surface-2)' }}
    >
      {options.map((o, i) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={`tab-pill ${active ? 'active' : ''}`}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Rank medallion — tinted numeral (never an emoji medal). */
function RankMedallion({ rank, size = 30 }: { rank: number; size?: number }) {
  const styles =
    rank === 1
      ? { background: 'var(--brass-100)', color: 'var(--brass-600)', border: '1px solid color-mix(in srgb, var(--brass-500) 40%, transparent)' }
      : rank === 2
        ? { background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--hairline-strong)' }
        : rank === 3
          ? { background: 'color-mix(in srgb, var(--brass-500) 10%, var(--surface-2))', color: 'var(--brass-600)', border: '1px solid var(--hairline)' }
          : { background: 'transparent', color: 'var(--text-3)', border: 'none' }
  return (
    <span
      className="mono inline-flex items-center justify-center rounded-full font-bold"
      style={{ width: size, height: size, fontSize: size * 0.42, ...styles }}
    >
      {rank}
    </span>
  )
}

/** Clickable top-3 podium card. */
function PodiumCard({
  entry,
  rank,
  metric,
  isSelf,
}: {
  entry: LeaderboardEntry
  rank: number
  metric: LeaderboardMetric
  isSelf: boolean
}) {
  const isFirst = rank === 1
  const tier = tierForVolume(entry.total_volume_usd)
  return (
    <Link
      href={traderHref(entry.id)}
      className="group flex flex-col items-center text-center outline-none"
      aria-label={`${displayName(entry)} — rank ${rank}`}
    >
      <div className="relative mb-3">
        <span
          className="block rounded-full ring-2 ring-transparent transition group-hover:ring-[var(--pip-300)] group-focus-visible:ring-[var(--pip-400)]"
          style={isFirst ? { boxShadow: '0 0 0 3px color-mix(in srgb, var(--brass-500) 30%, transparent)' } : undefined}
        >
          <TraderAvatar id={entry.id} name={displayName(entry)} imageUrl={entry.avatar_url} size={isFirst ? 66 : 54} tier={tier.key} />
        </span>
        <span className="absolute -bottom-1 -right-1">
          <RankMedallion rank={rank} size={isFirst ? 26 : 22} />
        </span>
      </div>
      <div className="flex max-w-[9.5rem] items-center gap-1.5">
        <p
          className="truncate text-sm font-semibold text-text-primary underline-offset-2 group-hover:text-pip-text group-hover:underline"
          title={displayName(entry)}
        >
          {displayName(entry)}
        </p>
        {isSelf && <span className="flex-none rounded-pill bg-pip-100 px-1.5 py-px text-[10px] font-semibold text-pip-text">You</span>}
      </div>
      <p className="mono mt-1 text-base font-bold" style={{ color: isFirst ? 'var(--brass-600)' : 'var(--text-primary)' }}>
        {primaryValue(entry, metric)}
      </p>
      <p className="mono mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
        {secondaryLine(entry, metric)}
      </p>
      <div
        className={`card mt-3 flex w-full items-center justify-center transition group-hover:border-[var(--pip-300)] ${isFirst ? 'h-16' : rank === 2 ? 'h-12' : 'h-9'}`}
        style={
          isFirst
            ? { borderColor: 'color-mix(in srgb, var(--brass-500) 45%, transparent)', background: 'color-mix(in srgb, var(--brass-500) 6%, var(--surface))' }
            : undefined
        }
      >
        <span className="mono text-lg font-bold" style={{ color: isFirst ? 'var(--brass-600)' : 'var(--text-3)' }}>
          {rank}
        </span>
      </div>
    </Link>
  )
}

function Podium({ rows, metric, selfId }: { rows: LeaderboardEntry[]; metric: LeaderboardMetric; selfId: string | null }) {
  // Visual order: #2 (left), #1 (center, tallest), #3 (right).
  const order = [1, 0, 2]
  return (
    <div className="mb-8 grid grid-cols-3 items-end gap-3 sm:gap-5">
      {order.map((idx, col) => {
        const p = rows[idx]
        if (!p) return <div key={col} />
        return <PodiumCard key={p.id} entry={p} rank={idx + 1} metric={metric} isSelf={p.id === selfId} />
      })}
    </div>
  )
}

export function LeaderboardView() {
  const router = useRouter()
  const [metric, setMetric] = useState<LeaderboardMetric>('volume')
  const [period, setPeriod] = useState<LeaderboardPeriod>('all')
  const [rows, setRows] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)
  const [selfId, setSelfId] = useState<string | null>(null)

  // Current user (for the "You" highlight + "your rank") — real, not hardcoded.
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setSelfId(data.user?.id ?? null))
  }, [])

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true)
      setErrored(false)
      try {
        const params = new URLSearchParams({ metric, period, limit: '100' })
        const res = await fetch(`/api/leaderboard?${params}`, { signal })
        const json = await res.json()
        setRows(Array.isArray(json.data) ? json.data : [])
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          setRows([])
          setErrored(true)
        }
      } finally {
        setLoading(false)
      }
    },
    [metric, period],
  )

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  const selfEntry = useMemo(
    () => (selfId ? rows.find((r) => r.id === selfId) ?? null : null),
    [rows, selfId],
  )
  const selfRank = selfEntry?.rank ?? (selfEntry ? rows.indexOf(selfEntry) + 1 : null)

  return (
    <div className="animate-fade-in">
      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          ariaLabel="Ranking metric"
          value={metric}
          onChange={(v) => setMetric(v as LeaderboardMetric)}
          options={LEADERBOARD_METRICS.map((m) => ({ value: m, label: METRIC_META[m].label }))}
        />
        <Segmented
          ariaLabel="Time period"
          value={period}
          onChange={(v) => setPeriod(v as LeaderboardPeriod)}
          options={LEADERBOARD_PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
        />
      </div>

      {/* Context bar: real ranked count + period, and the viewer's own rank. */}
      {!loading && !errored && rows.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-sm">
          <p style={{ color: 'var(--text-muted)' }}>
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{rows.length.toLocaleString()}</span>{' '}
            ranked {rows.length === 1 ? 'trader' : 'traders'} · ranked by {METRIC_META[metric].label.toLowerCase()} · {PERIOD_LABEL[period].toLowerCase()}
          </p>
          {selfEntry && selfRank != null && (
            <Link
              href={traderHref(selfEntry.id)}
              className="inline-flex items-center gap-1.5 rounded-pill border border-hairline px-3 py-1 font-medium transition-colors hover:border-[var(--pip-300)] hover:text-pip-text"
              style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}
            >
              Your rank <span className="mono font-bold" style={{ color: 'var(--text-primary)' }}>#{selfRank}</span>
              <span style={{ color: 'var(--text-muted)' }}>· {primaryValue(selfEntry, metric)}</span>
            </Link>
          )}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <div className="mb-8 grid grid-cols-3 items-end gap-4">
            {[52, 64, 44].map((h, i) => (
              <div key={i} className="flex flex-col items-center gap-3">
                <div className="skeleton h-14 w-14 rounded-full" />
                <div className="skeleton h-3 w-16 rounded" />
                <div className="skeleton w-full rounded-md" style={{ height: h }} />
              </div>
            ))}
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-14 rounded-md" />
          ))}
        </div>
      ) : errored ? (
        <div className="card flex flex-col items-center gap-2 px-6 py-16 text-center">
          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>Couldn&apos;t load the leaderboard</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Please try again in a moment.</p>
          <button className="btn btn-secondary btn-sm mt-2" onClick={() => load()}>Retry</button>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {rows.length >= 3 && <Podium rows={rows} metric={metric} selfId={selfId} />}
          <StandingsTable rows={rows} metric={metric} selfId={selfId} onRowActivate={(id) => router.push(traderHref(id))} />
        </>
      )}
    </div>
  )
}

function StandingsTable({
  rows,
  metric,
  selfId,
  onRowActivate,
}: {
  rows: LeaderboardEntry[]
  metric: LeaderboardMetric
  selfId: string | null
  onRowActivate: (id: string) => void
}) {
  const emphasize = (m: LeaderboardMetric) =>
    metric === m ? { color: 'var(--text-primary)', fontWeight: 700 } : undefined
  const th = (m: LeaderboardMetric) => (metric === m ? { color: 'var(--text-primary)' } : undefined)
  return (
    <div className="card table-wrapper overflow-x-auto p-0">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left" style={{ color: 'var(--text-muted)' }}>
            <th className="w-14 px-4 py-3 text-xs font-semibold">#</th>
            <th className="px-4 py-3 text-xs font-semibold">Trader</th>
            <th className="px-4 py-3 text-right text-xs font-semibold" style={th('volume')}>Volume</th>
            <th className="hidden px-4 py-3 text-right text-xs font-semibold sm:table-cell">Bets</th>
            <th className="px-4 py-3 text-right text-xs font-semibold" style={th('winrate')}>Win&nbsp;%</th>
            <th className="px-4 py-3 text-right text-xs font-semibold" style={th('pnl')}>P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => {
            const rank = p.rank ?? i + 1
            const pnlPositive = (p.profit_loss_usd || 0) >= 0
            const winGood = (p.win_rate || 0) >= 0.5
            const isSelf = p.id === selfId
            const tier = tierForVolume(p.total_volume_usd)
            return (
              <tr
                key={p.id}
                className="cursor-pointer border-t transition-colors hover:bg-[var(--surface-2)]"
                style={{
                  borderColor: 'var(--hairline)',
                  background: isSelf ? 'color-mix(in srgb, var(--pip-500) 6%, transparent)' : undefined,
                }}
                onClick={() => onRowActivate(p.id)}
              >
                <td className="px-4 py-3 align-middle">
                  {rank <= 3 ? <RankMedallion rank={rank} size={26} /> : <span className="mono pl-1.5 font-semibold" style={{ color: 'var(--text-3)' }}>{rank}</span>}
                </td>
                <td className="px-4 py-3 align-middle">
                  {/* Real link for a11y/SEO; stop the row's onClick from double-firing. */}
                  <TraderLink
                    id={p.id}
                    name={displayName(p)}
                    username={p.username}
                    avatarUrl={p.avatar_url}
                    size={32}
                    tier={tier.key}
                    showUsername={!!p.username}
                    isSelf={isSelf}
                    onClick={() => { /* Link handles navigation */ }}
                  />
                </td>
                <td className="mono px-4 py-3 text-right align-middle" style={emphasize('volume')}>{formatUsd(p.total_volume_usd)}</td>
                <td className="mono hidden px-4 py-3 text-right align-middle sm:table-cell" style={{ color: 'var(--text-2)' }}>{(p.total_bets || 0).toLocaleString()}</td>
                <td className="px-4 py-3 text-right align-middle">
                  <span className={`badge ${winGood ? 'badge-green' : 'badge-muted'}`} style={emphasize('winrate')}>{formatPct(p.win_rate)}</span>
                </td>
                <td
                  className="mono px-4 py-3 text-right align-middle font-semibold"
                  style={{ ...(emphasize('pnl') ?? {}), color: pnlPositive ? 'var(--yes-700)' : 'var(--no-700)' }}
                >
                  {formatSignedUsd(p.profit_loss_usd)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-20 text-center">
      <span
        className="flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: 'var(--pip-100)', color: 'var(--pip-text)' }}
      >
        <IconTrophy size={26} />
      </span>
      <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>No ranked traders yet</p>
      <p className="max-w-xs text-sm" style={{ color: 'var(--text-muted)' }}>
        Standings appear once traders start placing positions. Be the first to make the board.
      </p>
      <Link href="/markets" className="btn btn-primary btn-sm mt-1 gap-1.5">
        <IconTrendUp size={14} /> Explore markets
      </Link>
    </div>
  )
}
