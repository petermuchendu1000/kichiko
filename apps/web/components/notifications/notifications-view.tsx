'use client'

// Notifications — Pip system. Unread-first, time-grouped feed with typed icon
// medallions and group filters, live INSERT subscription, mark-read on click,
// bulk mark-all-read, and collapsible delivery preferences. No emoji, no DaisyUI.
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { NotificationPreferences } from '@/components/notifications/NotificationPreferences'
import type { Notification, NotificationType } from '@/types'
import {
  IconBell,
  IconSwap,
  IconTrophy,
  IconTrendDown,
  IconDeposit,
  IconWithdraw,
  IconWarning,
  IconShare,
  IconMarkets,
  IconCheck,
  IconClock,
  IconPercent,
  IconShield,
  IconChevronDown,
} from '@/components/ui/icons'

type Group = 'trades' | 'money' | 'markets' | 'account'
type Tone = 'pip' | 'yes' | 'no' | 'brass'

const TYPE_CONFIG: Record<NotificationType, { Icon: typeof IconBell; group: Group; tone: Tone }> = {
  bet_filled: { Icon: IconSwap, group: 'trades', tone: 'pip' },
  bet_won: { Icon: IconTrophy, group: 'trades', tone: 'yes' },
  bet_lost: { Icon: IconTrendDown, group: 'trades', tone: 'no' },
  deposit_completed: { Icon: IconDeposit, group: 'money', tone: 'yes' },
  withdrawal_completed: { Icon: IconWithdraw, group: 'money', tone: 'pip' },
  withdrawal_under_review: { Icon: IconClock, group: 'money', tone: 'brass' },
  withdrawal_failed: { Icon: IconWarning, group: 'money', tone: 'no' },
  referral_bonus: { Icon: IconShare, group: 'money', tone: 'brass' },
  market_created: { Icon: IconMarkets, group: 'markets', tone: 'pip' },
  market_resolved: { Icon: IconCheck, group: 'markets', tone: 'pip' },
  market_closing_soon: { Icon: IconClock, group: 'markets', tone: 'brass' },
  price_alert: { Icon: IconPercent, group: 'markets', tone: 'pip' },
  kyc_approved: { Icon: IconShield, group: 'account', tone: 'yes' },
  kyc_rejected: { Icon: IconWarning, group: 'account', tone: 'no' },
  system_announcement: { Icon: IconBell, group: 'account', tone: 'pip' },
}

const TONE_STYLE: Record<Tone, React.CSSProperties> = {
  pip: { background: 'var(--pip-100)', color: 'var(--pip-text)' },
  yes: { background: 'var(--yes-tint)', color: 'var(--yes-700)' },
  no: { background: 'var(--no-tint)', color: 'var(--no-700)' },
  brass: { background: 'var(--brass-100)', color: 'var(--brass-600)' },
}

const FILTERS: { value: 'all' | Group; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'trades', label: 'Trades' },
  { value: 'money', label: 'Money' },
  { value: 'markets', label: 'Markets' },
  { value: 'account', label: 'Account' },
]

function bucketOf(iso: string): 'Today' | 'This week' | 'Earlier' {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  if (then >= startOfToday.getTime()) return 'Today'
  if (now - then < 7 * 86400000) return 'This week'
  return 'Earlier'
}

function linkFor(n: Notification): string | null {
  const d = (n.data ?? {}) as Record<string, unknown>
  if (typeof d.href === 'string') return d.href
  if (typeof d.url === 'string') return d.url
  if (typeof d.market_slug === 'string') return `/markets/${d.market_slug}`
  return null
}

function Medallion({ type }: { type: NotificationType }) {
  const cfg = TYPE_CONFIG[type] ?? { Icon: IconBell, tone: 'pip' as Tone }
  const { Icon } = cfg
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
      style={TONE_STYLE[cfg.tone]}
      aria-hidden="true"
    >
      <Icon size={17} />
    </span>
  )
}

export function NotificationsView() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const [notifications, setNotifications] = useState<Notification[]>([])
  const [fetching, setFetching] = useState(true)
  const [filter, setFilter] = useState<'all' | Group>('all')
  const [showPrefs, setShowPrefs] = useState(false)

  useEffect(() => {
    if (!loading && !user) router.push('/auth/login')
  }, [user, loading, router])

  useEffect(() => {
    if (!user) return
    const load = async () => {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(100)
      setNotifications((data as Notification[]) || [])
      setFetching(false)
    }
    load()

    const channel = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload) => setNotifications((prev) => [payload.new as Notification, ...prev]),
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user, supabase])

  const markAllRead = async () => {
    if (!user) return
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })))
    await supabase
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('is_read', false)
  }

  const markRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
    await supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id)
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length

  const filtered = useMemo(
    () => (filter === 'all' ? notifications : notifications.filter((n) => TYPE_CONFIG[n.type]?.group === filter)),
    [notifications, filter],
  )

  // Preserve order (already desc) while grouping into time buckets.
  const groups = useMemo(() => {
    const order: ('Today' | 'This week' | 'Earlier')[] = ['Today', 'This week', 'Earlier']
    const map: Record<string, Notification[]> = { Today: [], 'This week': [], Earlier: [] }
    for (const n of filtered) map[bucketOf(n.created_at)].push(n)
    return order.filter((k) => map[k].length > 0).map((k) => ({ label: k, items: map[k] }))
  }, [filtered])

  if (loading || !user) {
    return (
      <div className="animate-fade-in space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-16 rounded-md" />
        ))}
      </div>
    )
  }

  return (
    <div className="animate-fade-in space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl" style={{ color: 'var(--text-primary)' }}>
            Notifications
          </h1>
          {unreadCount > 0 && (
            <span
              className="mono rounded-pill px-2 py-0.5 text-xs font-semibold"
              style={{ background: 'var(--pip-500)', color: '#fff' }}
            >
              {unreadCount}
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button className="btn btn-ghost btn-sm gap-1.5" onClick={markAllRead}>
            <IconCheck size={14} /> Mark all read
          </button>
        )}
      </div>

      {/* Preferences (collapsible) */}
      <div>
        <button
          className="flex w-full items-center justify-between rounded-md border px-4 py-3 transition-colors hover:bg-[var(--surface-2)]"
          style={{ borderColor: 'var(--hairline)', background: 'var(--surface)' }}
          aria-expanded={showPrefs}
          onClick={() => setShowPrefs((s) => !s)}
        >
          <span className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            <IconBell size={15} /> Delivery preferences
          </span>
          <IconChevronDown
            size={16}
            style={{ color: 'var(--text-muted)', transform: showPrefs ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur)' }}
          />
        </button>
        {showPrefs && (
          <div className="mt-3 animate-slide-up">
            <NotificationPreferences />
          </div>
        )}
      </div>

      {/* Type filters */}
      <div className="scrollbar-hide -mx-1 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label="Filter notifications by type">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className={`tab-pill shrink-0 ${filter === f.value ? 'active' : ''}`}
            aria-pressed={filter === f.value}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Feed */}
      {fetching ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-16 rounded-md" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState filtered={filter !== 'all'} />
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.label}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {g.label}
              </h2>
              <div className="card overflow-hidden p-0">
                {g.items.map((n, i) => (
                  <NotificationRow
                    key={n.id}
                    n={n}
                    first={i === 0}
                    onRead={() => markRead(n.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function NotificationRow({ n, first, onRead }: { n: Notification; first: boolean; onRead: () => void }) {
  const href = linkFor(n)
  const unread = !n.is_read
  const rel = (() => {
    try {
      return formatDistanceToNow(new Date(n.created_at), { addSuffix: true })
    } catch {
      return ''
    }
  })()

  const body = (
    <>
      <Medallion type={n.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {n.title}
          </p>
          {unread && (
            <span
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
              style={{ background: 'var(--pip-500)' }}
              aria-label="Unread"
            />
          )}
        </div>
        {n.body && (
          <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {n.body}
          </p>
        )}
        <p className="mono mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {rel}
        </p>
      </div>
    </>
  )

  const rowStyle: React.CSSProperties = {
    borderTop: first ? 'none' : '1px solid var(--hairline)',
    borderLeft: unread ? '2px solid var(--pip-500)' : '2px solid transparent',
    background: unread ? 'color-mix(in srgb, var(--pip-500) 4%, var(--surface))' : 'var(--surface)',
  }

  const cls = 'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-2)]'

  if (href) {
    return (
      <Link href={href} className={cls} style={rowStyle} onClick={() => unread && onRead()}>
        {body}
      </Link>
    )
  }
  if (unread) {
    return (
      <button type="button" className={cls} style={rowStyle} onClick={onRead}>
        {body}
      </button>
    )
  }
  return (
    <div className={cls} style={rowStyle}>
      {body}
    </div>
  )
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-20 text-center">
      <span
        className="flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}
      >
        <IconBell size={26} />
      </span>
      <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
        {filtered ? 'Nothing here' : "You're all caught up"}
      </p>
      <p className="max-w-xs text-sm" style={{ color: 'var(--text-muted)' }}>
        {filtered
          ? 'No notifications in this category yet.'
          : 'New alerts about your trades, money and markets will appear here.'}
      </p>
    </div>
  )
}
