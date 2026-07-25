'use client'

// components/leaderboard/leaderboard-view.tsx
// ---------------------------------------------------------------------------
// Leaderboard — institutional league table (Pip system). A metric segmented
// control + period pills, a professional top-3 podium (gold / silver / bronze,
// #1 crowned and elevated) and a metric-rich standings table. Every trader is a
// link to their public profile (/traders/{id}); the current user's row is
// highlighted and their rank is surfaced. Backed by GET /api/leaderboard.
// No hardcoded rows — all figures come from the API.
//
// Design language borrows the conventions common to best-in-class competitive
// fintech leaderboards (Polymarket standings, BrightFunded / prop-firm podiums,
// the shadcn "medal podium" pattern): a three-tier hero podium for the top
// three, then a dense, scannable table with color-coded P&L and win-rate and a
// clearly emphasised active-metric column.
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

// Medal palette for the top three. Gold reuses the brand brass tokens; silver
// (cool steel) and bronze (warm) are the two hues a medal set genuinely needs
// to stay distinguishable — defined once here, never inlined ad hoc.
type Medal = { label: string; ordinal: string; accent: string; ring: string; tint: string }
const MEDALS: Record<1 | 2 | 3, Medal> = {
  1: {
    label: '1st',
    ordinal: '1',
    accent: 'var(--brass-600)',
    ring: 'var(--brass-500)',
    tint: 'var(--brass-100)',
  },
  2: {
    label: '2nd',
    ordinal: '2',
    accent: '#7C8698',
    ring: '#9AA4B2',
    tint: 'color-mix(in srgb, #9AA4B2 16%, var(--surface))',
  },
  3: {
    label: '3rd',
    ordinal: '3',
    accent: '#A9713C',
    ring: '#C08A4E',
    tint: 'color-mix(in srgb, #C08A4E 15%, var(--surface))',
  },
}

/** Primary metric value for the active metric (podium hero + emphasised column). */
function primaryValue(e: LeaderboardEntry, metric: LeaderboardMetric): string {
  if (metric === 'winrate') return formatPct(e.win_rate)
  if (metric === 'pnl') return formatSignedUsd(e.profit_loss_usd)
  return formatUsd(e.total_volume_usd)
}

/** Small crown for the champion — inline (the shared icon set has no crown). */
function Crown({ size = 15, color }: { size?: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true">
      <path d="M3 8l4 3 5-6 5 6 4-3-2 11H5L3 8z" />
    </svg>
  )
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

/** Rank medallion — tinted numeral used in the standings table (never emoji). */
function RankMedallion({ rank, size = 28 }: { rank: number; size?: number }) {
  const medal = rank <= 3 ? MEDALS[rank as 1 | 2 | 3] : null
  const styles = medal
    ? { background: medal.tint, color: medal.accent, border: `1px solid ${medal.ring}` }
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

/** One supporting stat on a podium card; the active metric is emphasised. */
function StatChip({
  label,
  value,
  emphasise,
  accent,
  tone,
}: {
  label: string
  value: string
  emphasise: boolean
  accent: string
  tone?: 'pos' | 'neg'
}) {
  const valueColor = tone === 'pos' ? 'var(--yes-700)' : tone === 'neg' ? 'var(--no-700)' : 'var(--text-primary)'
  return (
    <div
      className="flex flex-col items-center rounded-md px-1 py-1.5"
      style={emphasise ? { background: 'color-mix(in srgb, var(--pip-500) 7%, transparent)' } : undefined}
    >
      <span
        className="text-[10px] font-semibold uppercase tracking-wide"
        style={{ color: emphasise ? accent : 'var(--text-muted)' }}
      >
        {label}
      </span>
      <span className="mono mt-0.5 text-xs font-semibold" style={{ color: valueColor }}>
        {value}
      </span>
    </div>
  )
}

/** Clickable top-3 podium hero card — a real, filled surface (no empty box). */
function PodiumCard({
  entry,
  rank,
  metric,
  isSelf,
}: {
  entry: LeaderboardEntry
  rank: 1 | 2 | 3
  metric: LeaderboardMetric
  isSelf: boolean
}) {
  const medal = MEDALS[rank]
  const isFirst = rank === 1
  const tier = tierForVolume(entry.total_volume_usd)
  const avatarSize = isFirst ? 72 : 56
  const pnlPositive = (entry.profit_loss_usd || 0) >= 0
  // sm+ visual order: #2 (left), #1 (centre), #3 (right). items-end + a taller
  // #1 card forms the podium "step" without any transforms.
  const orderClass = isFirst ? 'sm:order-2' : rank === 2 ? 'sm:order-1' : 'sm:order-3'
  return (
    <Link
      href={traderHref(entry.id)}
      aria-label={`${displayName(entry)} — rank ${rank}, ${primaryValue(entry, metric)}`}
      className={`group relative flex w-full flex-col items-center rounded-2xl border px-4 pb-4 pt-9 text-center outline-none transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[var(--pip-400)] ${orderClass} ${
        isFirst ? 'sm:min-h-[286px]' : 'sm:min-h-[248px]'
      }`}
      style={{
        borderColor: isFirst ? medal.ring : 'var(--hairline)',
        background: isFirst
          ? `linear-gradient(180deg, ${medal.tint} 0%, var(--surface) 58%)`
          : 'var(--surface)',
        boxShadow: isFirst ? 'var(--e2)' : 'var(--e1)',
      }}
    >
      {/* Medal ribbon */}
      <span
        className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-pill px-2.5 py-0.5 text-xs font-bold shadow-sm"
        style={{ background: medal.tint, color: medal.accent, border: `1px solid ${medal.ring}` }}
      >
        {isFirst && <Crown size={13} color={medal.accent} />}
        {medal.label}
      </span>

      {/* Avatar with medal-tinted ring */}
      <span
        className="relative mb-2.5 inline-flex rounded-full"
        style={{ boxShadow: `0 0 0 3px ${medal.ring}, 0 0 0 6px color-mix(in srgb, ${medal.ring} 22%, transparent)` }}
      >
        <TraderAvatar
          id={entry.id}
          name={displayName(entry)}
          imageUrl={entry.avatar_url}
          size={avatarSize}
          tier={tier.key}
        />
      </span>

      {/* Identity */}
      <div className="flex max-w-full items-center justify-center gap-1.5">
        <p
          className="max-w-[10rem] truncate text-sm font-semibold underline-offset-2 group-hover:underline"
          style={{ color: 'var(--text-primary)' }}
          title={displayName(entry)}
        >
          {displayName(entry)}
        </p>
        {isSelf && (
          <span className="flex-none rounded-pill bg-pip-100 px-1.5 py-px text-[10px] font-semibold text-pip-text">
            You
          </span>
        )}
      </div>
      {entry.username && (
        <p className="mt-0.5 max-w-[11rem] truncate text-xs" style={{ color: 'var(--text-muted)' }}>
          @{entry.username}
        </p>
      )}

      {/* Hero metric (the active ranking metric) */}
      <p
        className={`mono mt-2 font-bold ${isFirst ? 'text-2xl' : 'text-xl'}`}
        style={{
          color:
            metric === 'pnl'
              ? pnlPositive
                ? 'var(--yes-700)'
                : 'var(--no-700)'
              : isFirst
                ? medal.accent
                : 'var(--text-primary)',
        }}
      >
        {primaryValue(entry, metric)}
      </p>
      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {METRIC_META[metric].label}
      </p>

      {/* Supporting stats — always all three, active one emphasised. */}
      <div
        className="mt-3 grid w-full grid-cols-3 gap-1 border-t pt-3"
        style={{ borderColor: 'var(--hairline)' }}
      >
        <StatChip label="Vol" value={formatUsd(entry.total_volume_usd)} emphasise={metric === 'volume'} accent={medal.accent} />
        <StatChip label="Win" value={formatPct(entry.win_rate)} emphasise={metric === 'winrate'} accent={medal.accent} />
        <StatChip
          label="P&L"
          value={formatSignedUsd(entry.profit_loss_usd)}
          emphasise={metric === 'pnl'}
          accent={medal.accent}
          tone={pnlPositive ? 'pos' : 'neg'}
        />
      </div>
    </Link>
  )
}

function Podium({ rows, metric, selfId }: { rows: LeaderboardEntry[]; metric: LeaderboardMetric; selfId: string | null }) {
  const top3 = rows.slice(0, 3)
  return (
    <div className="mb-8 grid grid-cols-1 items-stretch gap-4 sm:grid-cols-3 sm:items-end">
      {top3.map((p, i) => (
        <PodiumCard key={p.id} entry={p} rank={(i + 1) as 1 | 2 | 3} metric={metric} isSelf={p.id === selfId} />
      ))}
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
          <div className="mb-8 grid grid-cols-1 items-end gap-4 sm:grid-cols-3">
            {[248, 286, 248].map((h, i) => (
              <div key={i} className="skeleton w-full rounded-2xl" style={{ height: h }} />
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

// Sortable columns in the standings table.
type SortCol = 'rank' | 'trader' | 'volume' | 'bets' | 'winrate' | 'pnl'

/** Sort direction caret: a chevron for the active column, a faint ⇅ hint on
 *  hover for sortable-but-inactive columns. */
function SortCaret({ state }: { state: 'asc' | 'desc' | 'none' }) {
  if (state === 'none') {
    return (
      <svg
        className="opacity-0 transition-opacity group-hover/sort:opacity-40"
        width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      >
        <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
      </svg>
    )
  }
  return (
    <svg
      width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ transform: state === 'asc' ? 'rotate(180deg)' : undefined }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
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
  // Client-side table sort. Default (sort === null) preserves the API ranking
  // for the selected metric/period. The rank (#) column always shows each
  // trader's TRUE rank even when the view is re-sorted by another column.
  const [sort, setSort] = useState<{ col: SortCol; dir: 'asc' | 'desc' } | null>(null)
  // Reset to the ranked order whenever the data changes (a metric/period switch
  // refetches and hands down a new rows array).
  useEffect(() => {
    setSort(null)
  }, [rows])

  // Stable map of id -> true rank, taken from the API order (independent of the
  // current table sort) so the # column never lies after re-sorting.
  const rankOf = useMemo(
    () => new Map(rows.map((r, i) => [r.id, r.rank ?? i + 1])),
    [rows],
  )

  const sortValue = (p: LeaderboardEntry, col: SortCol): number | string => {
    switch (col) {
      case 'rank': return rankOf.get(p.id) ?? 0
      case 'trader': return displayName(p).toLowerCase()
      case 'bets': return p.total_bets ?? 0
      case 'winrate': return p.win_rate ?? 0
      case 'pnl': return p.profit_loss_usd ?? 0
      default: return p.total_volume_usd ?? 0
    }
  }

  const sorted = useMemo(() => {
    if (!sort) return rows
    const arr = [...rows]
    arr.sort((a, b) => {
      const va = sortValue(a, sort.col)
      const vb = sortValue(b, sort.col)
      const cmp =
        typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number)
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, rankOf])

  const toggleSort = (col: SortCol) =>
    setSort((cur) =>
      cur?.col === col
        ? { col, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: col === 'trader' || col === 'rank' ? 'asc' : 'desc' },
    )

  const ariaSort = (col: SortCol): 'ascending' | 'descending' | 'none' =>
    sort?.col === col ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'

  const emphasize = (m: LeaderboardMetric) =>
    metric === m ? { color: 'var(--text-primary)', fontWeight: 700 } : undefined

  /** A sortable header cell (full clickable button + caret). The active sort or
   *  the active ranking metric tints the label. */
  function SortHeader({
    col,
    label,
    align = 'right',
    className = '',
  }: {
    col: SortCol
    label: React.ReactNode
    align?: 'left' | 'right'
    className?: string
  }) {
    const active = sort?.col === col
    const metricActive =
      (col === 'volume' && metric === 'volume') ||
      (col === 'winrate' && metric === 'winrate') ||
      (col === 'pnl' && metric === 'pnl')
    return (
      <th
        className={`px-4 py-3 text-xs font-semibold ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
        aria-sort={ariaSort(col)}
      >
        <button
          type="button"
          onClick={() => toggleSort(col)}
          aria-label={`Sort by ${typeof label === 'string' ? label : col}`}
          className="group/sort inline-flex items-center gap-1 whitespace-nowrap transition-colors hover:text-text-primary"
          style={{ color: active || metricActive ? 'var(--text-primary)' : undefined }}
        >
          <span>{label}</span>
          <SortCaret state={active ? sort!.dir : 'none'} />
        </button>
      </th>
    )
  }

  return (
    <div className="card table-wrapper overflow-x-auto p-0">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr
            className="text-left"
            style={{ color: 'var(--text-muted)', background: 'var(--surface-2)' }}
          >
            <th className="w-14 px-4 py-3 text-left text-xs font-semibold" aria-sort={ariaSort('rank')}>
              <button
                type="button"
                onClick={() => toggleSort('rank')}
                aria-label="Sort by rank"
                className="group/sort inline-flex items-center gap-1 transition-colors hover:text-text-primary"
                style={{ color: sort?.col === 'rank' ? 'var(--text-primary)' : undefined }}
              >
                <span>#</span>
                <SortCaret state={sort?.col === 'rank' ? sort.dir : 'none'} />
              </button>
            </th>
            <SortHeader col="trader" label="Trader" align="left" />
            <SortHeader col="volume" label="Volume" />
            <SortHeader col="bets" label="Bets" className="hidden sm:table-cell" />
            <SortHeader col="winrate" label={<>Win&nbsp;%</>} />
            <SortHeader col="pnl" label={<>P&amp;L</>} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((p, i) => {
            const rank = rankOf.get(p.id) ?? i + 1
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
                  boxShadow: isSelf ? 'inset 3px 0 0 0 var(--pip-500)' : undefined,
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
