'use client'

// components/markets/market-comments.tsx
// Community block for the market detail page — a tabbed panel that unifies the
// four social/data views seen on leading prediction markets:
//   Comments · Top Holders · Positions · Activity
// Each non-comment tab lazy-loads its data from Supabase on first open and
// renders a tasteful empty state until there is something to show. All trading
// numbers come straight from the `positions` / `market_activity` tables.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { TraderAvatar } from '@/components/ui/trader-avatar'
import { TraderNameLink, traderHref } from '@/components/ui/trader-link'
import Link from 'next/link'
import { MarketActivity } from '@/components/markets/market-activity'
import { TopHolders } from '@/components/markets/top-holders'
import { MarketPositions } from '@/components/markets/market-positions'
import toast from 'react-hot-toast'
import type { Comment, MarketOption } from '@/types'

type TabKey = 'comments' | 'holders' | 'positions' | 'activity'
type CommentSort = 'newest' | 'oldest'

function Spinner() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  )
}

function TabLoading() {
  return (
    <div className="space-y-3 py-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-8 w-8 flex-none skeleton rounded-full" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-28 skeleton rounded" />
            <div className="h-3 w-16 skeleton rounded" />
          </div>
          <div className="h-4 w-14 skeleton rounded" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-text-muted">{children}</p>
}

// ---- data shapes ----------------------------------------------------------
interface ActivityRow {
  id: string
  user_id: string
  action: string
  amount_usd: number | null
  side: 'yes' | 'no' | null
  price: number | null
  created_at: string | null
  user?: { display_name: string | null; username: string | null }
}

function Avatar({ id, u }: { id: string; u?: { display_name: string | null; username: string | null } | null }) {
  return <TraderAvatar id={id} name={u?.display_name || u?.username || null} size={32} />
}

interface MarketCommentsProps {
  marketId: string
  options?: MarketOption[] | null
  resolutionType?: string | null
}

export function MarketComments({ marketId, options, resolutionType }: MarketCommentsProps) {
  const { user } = useAuth()
  const supabase = useMemo(() => createClient(), [])
  const [tab, setTab] = useState<TabKey>('comments')

  // ---- comments state -----------------------------------------------------
  const [comments, setComments] = useState<Comment[]>([])
  const [newComment, setNewComment] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // PM parity: comments carry a sort control (their default reads "Newest").
  const [sort, setSort] = useState<CommentSort>('newest')

  // ---- lazy tab state -----------------------------------------------------
  // Top Holders and Positions are delegated to their own RPC-backed boards
  // (<TopHolders/> / <MarketPositions/>); only Activity is fetched here.
  const [activity, setActivity] = useState<ActivityRow[] | null>(null)

  const fetchComments = useCallback(async () => {
    const { data } = await supabase
      .from('comments')
      .select('*, user:profiles!comments_user_id_fkey(id, display_name, avatar_url, username)')
      .eq('market_id', marketId)
      .eq('is_deleted', false)
      .is('parent_id', null)
      .order('created_at', { ascending: false })
      .limit(50)
    setComments((data as Comment[]) || [])
    setIsLoading(false)
  }, [supabase, marketId])

  useEffect(() => {
    fetchComments()
    const channel = supabase
      .channel(`comments:${marketId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments', filter: `market_id=eq.${marketId}` },
        () => fetchComments(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [marketId, supabase, fetchComments])

  // Lazy-load a tab's data the first time it's opened.
  useEffect(() => {
    if (tab === 'activity' && activity === null) {
      supabase
        .from('market_activity')
        .select('id, user_id, action, amount_usd, side, price, created_at, user:profiles!market_activity_user_id_fkey(display_name, username)')
        .eq('market_id', marketId)
        .order('created_at', { ascending: false })
        .limit(30)
        .then(({ data }) => setActivity(((data as unknown) as ActivityRow[]) || []))
    }
  }, [tab, marketId, supabase, activity])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) {
      toast.error('Sign in to comment')
      return
    }
    if (!newComment.trim() || newComment.length < 2) return
    setIsSubmitting(true)
    const { error } = await supabase.from('comments').insert({
      market_id: marketId,
      user_id: user.id,
      content: newComment.trim(),
    })
    if (error) {
      toast.error('Failed to post comment')
    } else {
      setNewComment('')
      await fetchComments()
    }
    setIsSubmitting(false)
  }

  // Client-side ordering of the already-fetched page (PM's "Newest" default,
  // with an "Oldest" alternative). Sorting a fetched slice keeps the control
  // instant with no refetch; `created_at` is the single source of truth.
  const sortedComments = useMemo(() => {
    const arr = [...comments]
    arr.sort((a, b) => {
      const ta = new Date(a.created_at).getTime()
      const tb = new Date(b.created_at).getTime()
      return sort === 'newest' ? tb - ta : ta - tb
    })
    return arr
  }, [comments, sort])

  const tabs: { key: TabKey; label: string }[] = [
    // PM shows the count in parens with a thousands separator: "Comments (3,993)".
    { key: 'comments', label: `Comments${comments.length ? ` (${comments.length.toLocaleString('en-US')})` : ''}` },
    // PM label casing is "Top Holders" (both words capitalised).
    { key: 'holders', label: 'Top Holders' },
    { key: 'positions', label: 'Positions' },
    { key: 'activity', label: 'Activity' },
  ]

  return (
    <div className="p-4 max-lg:px-0">
      {/* Tab bar — PM parity: color-only active state (no underline bar, no
          icons), 16px semibold labels, gap-4, horizontally scrollable. Active =
          primary ink, inactive = muted grey. */}
      <div role="tablist" aria-label="Community" className="mb-4 flex gap-4 overflow-x-auto">
        {tabs.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`flex-none whitespace-nowrap pb-2 pt-1 text-base font-semibold transition-colors ${
                active ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Comments */}
      {tab === 'comments' && (
        <>
          {user && (
            <form onSubmit={handleSubmit} className="mb-4 flex gap-2">
              <label htmlFor="market-comment" className="sr-only">
                Add a comment
              </label>
              <input
                id="market-comment"
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment…"
                maxLength={500}
                className="input flex-1"
              />
              <button
                type="submit"
                disabled={isSubmitting || !newComment.trim()}
                className="btn btn-primary flex-none"
                aria-label="Post comment"
              >
                {/* PM parity: the composer action is a text "Post" button (with
                    the arrow glyph kept as a compact affordance while sending). */}
                {isSubmitting ? <Spinner /> : 'Post'}
              </button>
            </form>
          )}
          {isLoading ? (
            <TabLoading />
          ) : comments.length === 0 ? (
            <EmptyState>No comments yet. Be the first to share your prediction.</EmptyState>
          ) : (
            <>
              {/* Sort control (PM parity — their comments default to "Newest"). */}
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs text-text-muted">
                  {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
                </span>
                <div className="relative">
                  <label htmlFor="comment-sort" className="sr-only">
                    Sort comments
                  </label>
                  <select
                    id="comment-sort"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as CommentSort)}
                    className="appearance-none rounded-sm border border-hairline bg-transparent py-1 pl-2.5 pr-7 text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary"
                  >
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                  </select>
                  <svg
                    className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-text-muted"
                    width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>
              </div>
              <div className="space-y-4">
              {sortedComments.map((comment) => (
                <div key={comment.id} className="flex gap-3">
                  <Link href={traderHref(comment.user_id)} className="flex-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--pip-400)]" aria-label={`${comment.user?.display_name || comment.user?.username || 'trader'} profile`}>
                    <Avatar id={comment.user_id} u={comment.user} />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex items-center gap-2">
                      <TraderNameLink
                        id={comment.user_id}
                        name={comment.user?.display_name || comment.user?.username || 'Anonymous'}
                        className="text-sm"
                      />
                      <span className="flex-none text-xs text-text-muted">
                        {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-text-secondary">{comment.content}</p>
                  </div>
                </div>
              ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Top holders — RPC-backed Yes/No board (Board→Peek→Profile). */}
      {tab === 'holders' && (
        <TopHolders marketId={marketId} options={options} resolutionType={resolutionType} />
      )}

      {/* Positions — market-wide Yes/No board (Polymarket parity). */}
      {tab === 'positions' && (
        <MarketPositions marketId={marketId} options={options} resolutionType={resolutionType} />
      )}

      {/* Activity */}
      {tab === 'activity' &&
        (activity === null ? (
          <TabLoading />
        ) : (
          <MarketActivity activity={activity} />
        ))}
    </div>
  )
}
