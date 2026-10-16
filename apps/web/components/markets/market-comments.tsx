'use client'

// components/markets/market-comments.tsx
// Community block for the market detail page — a tabbed panel that unifies the
// four social/data views seen on leading prediction markets:
//   Comments · Top Holders · Positions · Activity
// Each non-comment tab lazy-loads its data from Supabase on first open and
// renders a tasteful empty state until there is something to show. All trading
// numbers come straight from the `positions` / `market_activity` tables.
//
// Comments are a full social thread: users can post on the market, REPLY to
// other users' comments, LIKE (toggle) any comment or reply, and SHARE a deep
// link to a specific comment. Threading is intentionally kept flat (two levels)
// — a reply to a reply is attached to the same thread root — which matches the
// mental model on leading prediction markets and keeps the DOM shallow.
//
// Data model (migration 037):
//   comments      — id, market_id, user_id, parent_id (self-FK), content,
//                   is_deleted (soft delete), like_count (denormalised).
//   comment_likes — (comment_id, user_id) PK; a SECURITY DEFINER trigger keeps
//                   comments.like_count in sync on INSERT/DELETE.
// Reads/writes go through the RLS-protected browser client (self-only writes),
// mirroring how top-level comments were already posted. No notifications are
// emitted for likes or replies (explicit product decision).
//
// `comment_likes` is not in the generated Supabase types yet, so the two calls
// that touch it use the repo's existing `as never` cast pattern (see
// market-positions / top-holders) rather than regenerating types here.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { TraderAvatar } from '@/components/ui/trader-avatar'
import { TraderNameLink, traderHref } from '@/components/ui/trader-link'
import { IconComments, IconShare } from '@/components/ui/icons'
import Link from 'next/link'
import { MarketActivity } from '@/components/markets/market-activity'
import { TopHolders } from '@/components/markets/top-holders'
import { toHoldingMap, describeHolding, type CommentHoldingMap, type HoldingRow } from '@/lib/markets/comment-holdings'
import { MarketPositions } from '@/components/markets/market-positions'
import toast from 'react-hot-toast'
import type { Comment, MarketOption } from '@/types'

type TabKey = 'comments' | 'holders' | 'positions' | 'activity'
type CommentSort = 'newest' | 'oldest'

// A comment plus its (already-resolved) direct replies. Built client-side from
// the flat fetch so rendering is a simple two-level walk.
type CommentNode = Comment & { children: Comment[] }

function Spinner() {
  return (
    <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  )
}

// Filled/outline heart for the like affordance. The shared icon set is
// stroke-only (fill="none"); the "liked" state needs a solid fill, so this is a
// purpose-built local glyph rather than a stroke icon.
function HeartIcon({ filled, size = 15 }: { filled: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 10-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z" />
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

function Avatar({ id, u, size = 32 }: { id: string; u?: { display_name: string | null; username: string | null } | null; size?: number }) {
  return <TraderAvatar id={id} name={u?.display_name || u?.username || null} size={size} />
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
  // `comments` is the flat, non-deleted set for this market (top-level + replies).
  const [comments, setComments] = useState<Comment[]>([])
  const [newComment, setNewComment] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // PM parity: comments carry a sort control (their default reads "Newest").
  const [sort, setSort] = useState<CommentSort>('newest')

  // Social interaction state.
  //  - likedIds : comment ids the current user has liked (drives the toggle).
  //  - likePending / replyPending guard against double-submits per comment.
  //  - replyingTo / replyText back the single inline reply composer.
  // Which side each commenter is on (matrix C10). Side only, never size —
  // see lib/markets/comment-holdings.ts and migration 115.
  const [holdings, setHoldings] = useState<CommentHoldingMap>({})
  const [holdersOnly, setHoldersOnly] = useState(false)
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set())
  const [likePending, setLikePending] = useState<Set<string>>(new Set())
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyPending, setReplyPending] = useState(false)
  const replyInputRef = useRef<HTMLInputElement | null>(null)

  // ---- lazy tab state -----------------------------------------------------
  const [activity, setActivity] = useState<ActivityRow[] | null>(null)

  const fetchComments = useCallback(async () => {
    // Fetch the whole non-deleted thread set (top-level + replies) in one round
    // trip; threading is assembled client-side. RLS already hides soft-deleted
    // rows, and the explicit is_deleted filter keeps the intent obvious.
    const { data } = await supabase
      .from('comments')
      .select('*, user:profiles!comments_user_id_fkey(id, display_name, avatar_url, username)')
      .eq('market_id', marketId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true })
      .limit(500)
    const rows = (data as Comment[]) || []
    setComments(rows)

    // Disclosure badges. Best-effort and deliberately not awaited with the
    // comments: a thread that renders without badges is degraded, a thread
    // that does not render at all because a disclosure lookup failed is
    // broken.
    void supabase
      .rpc('market_comment_holdings' as never, { p_market_id: marketId } as never)
      .then(({ data: hRows }) => {
        setHoldings(toHoldingMap((hRows as unknown as HoldingRow[]) ?? []))
      })

    // Seed "liked by me" so the heart renders in the correct state on load.
    if (user && rows.length) {
      const ids = rows.map((c) => c.id)
      const { data: likeRows } = await supabase
        .from('comment_likes' as never)
        .select('comment_id')
        .eq('user_id', user.id)
        .in('comment_id', ids)
      const liked = new Set<string>(((likeRows as { comment_id: string }[] | null) || []).map((r) => r.comment_id))
      setLikedIds(liked)
    } else {
      setLikedIds(new Set())
    }
    setIsLoading(false)
  }, [supabase, marketId, user])

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

  // Focus the inline reply field when it opens (keyboard + a11y nicety).
  useEffect(() => {
    if (replyingTo) replyInputRef.current?.focus()
  }, [replyingTo])

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
    const content = newComment.trim()
    if (content.length < 2) return
    setIsSubmitting(true)
    const { error } = await supabase.from('comments').insert({
      market_id: marketId,
      user_id: user.id,
      content,
    })
    if (error) {
      toast.error('Failed to post comment')
    } else {
      setNewComment('')
      await fetchComments()
    }
    setIsSubmitting(false)
  }

  // Post a reply. parent_id is pinned to the THREAD ROOT so nesting stays flat
  // (a reply to a reply lands in the same thread, not a third level).
  const handleReply = async (rootId: string) => {
    if (!user) {
      toast.error('Sign in to reply')
      return
    }
    const content = replyText.trim()
    if (content.length < 2) return
    setReplyPending(true)
    const { error } = await supabase.from('comments').insert({
      market_id: marketId,
      user_id: user.id,
      parent_id: rootId,
      content,
    })
    if (error) {
      toast.error('Failed to post reply')
    } else {
      setReplyText('')
      setReplyingTo(null)
      await fetchComments()
    }
    setReplyPending(false)
  }

  // Optimistic like toggle. We flip likedIds + the local like_count immediately,
  // then write to comment_likes; on error we roll the optimistic change back.
  const toggleLike = async (commentId: string) => {
    if (!user) {
      toast.error('Sign in to like')
      return
    }
    if (likePending.has(commentId)) return
    const wasLiked = likedIds.has(commentId)

    setLikePending((prev) => new Set(prev).add(commentId))
    setLikedIds((prev) => {
      const next = new Set(prev)
      if (wasLiked) next.delete(commentId)
      else next.add(commentId)
      return next
    })
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? { ...c, like_count: Math.max(0, (c.like_count || 0) + (wasLiked ? -1 : 1)) }
          : c,
      ),
    )

    const { error } = wasLiked
      ? await supabase
          .from('comment_likes' as never)
          .delete()
          .eq('comment_id', commentId)
          .eq('user_id', user.id)
      : await supabase.from('comment_likes' as never).insert({ comment_id: commentId, user_id: user.id } as never)

    if (error) {
      // Roll back the optimistic update.
      setLikedIds((prev) => {
        const next = new Set(prev)
        if (wasLiked) next.add(commentId)
        else next.delete(commentId)
        return next
      })
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, like_count: Math.max(0, (c.like_count || 0) + (wasLiked ? 1 : -1)) }
            : c,
        ),
      )
      toast.error(wasLiked ? 'Failed to remove like' : 'Failed to like')
    }
    setLikePending((prev) => {
      const next = new Set(prev)
      next.delete(commentId)
      return next
    })
  }

  // Share a deep link to a specific comment (anchor #c-{id}). Uses the native
  // share sheet when available, else copies the link to the clipboard.
  const shareComment = async (commentId: string) => {
    if (typeof window === 'undefined') return
    const url = `${window.location.origin}${window.location.pathname}#c-${commentId}`
    try {
      if (navigator.share) {
        await navigator.share({ url })
        return
      }
    } catch {
      // User dismissed the share sheet — fall through to clipboard copy.
    }
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy link')
    }
  }

  // Build the two-level thread tree from the flat set. A reply whose parent is
  // absent (parent soft-deleted → filtered by RLS) "bubbles up" to top level so
  // the reply never silently vanishes. Top-level order follows the sort control;
  // replies are always chronological (oldest→newest) for readable conversation.
  const threads = useMemo<CommentNode[]>(() => {
    const byId = new Map<string, Comment>()
    for (const c of comments) byId.set(c.id, c)

    // The holders filter keeps a ROOT when the root's author holds, or when
    // any reply under it does — so turning it on narrows the thread list
    // rather than shredding conversations into orphaned halves. A reply by a
    // holder is still worth reading in the context of the question it answers.
    const holderIds = new Set(Object.keys(holdings))
    const keepRoot = (c: Comment): boolean => {
      if (!holdersOnly) return true
      if (holderIds.has(c.user_id)) return true
      return comments.some((r) => r.parent_id === c.id && holderIds.has(r.user_id))
    }

    const childrenOf = new Map<string, Comment[]>()
    const roots: Comment[] = []
    for (const c of comments) {
      const isRoot = !c.parent_id || !byId.has(c.parent_id)
      if (isRoot) {
        if (keepRoot(c)) roots.push(c)
      } else {
        const arr = childrenOf.get(c.parent_id!) || []
        arr.push(c)
        childrenOf.set(c.parent_id!, arr)
      }
    }

    roots.sort((a, b) => {
      const ta = new Date(a.created_at).getTime()
      const tb = new Date(b.created_at).getTime()
      return sort === 'newest' ? tb - ta : ta - tb
    })

    return roots.map((r) => ({
      ...r,
      children: (childrenOf.get(r.id) || []).sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      ),
    }))
  }, [comments, sort, holdersOnly, holdings])

  const tabs: { key: TabKey; label: string }[] = [
    // PM shows the count in parens with a thousands separator: "Comments (3,993)".
    { key: 'comments', label: `Comments${comments.length ? ` (${comments.length.toLocaleString('en-US')})` : ''}` },
    { key: 'holders', label: 'Top Holders' },
    { key: 'positions', label: 'Positions' },
    { key: 'activity', label: 'Activity' },
  ]

  // ---- one comment (used for both roots and replies) ----------------------
  function CommentBody({ comment, isReply, rootId }: { comment: Comment; isReply: boolean; rootId: string }) {
    const liked = likedIds.has(comment.id)
    const pending = likePending.has(comment.id)
    const name = comment.user?.display_name || comment.user?.username || 'Anonymous'
    return (
      <div id={`c-${comment.id}`} className="group flex gap-3 scroll-mt-24">
        <Link
          href={traderHref(comment.user_id)}
          className="flex-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--pip-400)]"
          aria-label={`${name} profile`}
        >
          <Avatar id={comment.user_id} u={comment.user} size={isReply ? 28 : 32} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-center gap-2">
            <TraderNameLink id={comment.user_id} name={name} className="text-sm" />
            {/* DISCLOSURE BADGE (matrix C10, migration 115).
                Polymarket wears the commenter's position beside their name —
                `76.7K Flávio Bolsonaro`. A reader deciding what to make of
                "Ruto is finished" is entitled to know the author is short
                Ruto, and on this board they could not find out.

                SIDE, NEVER SIZE. Their commenters are pseudonymous wallets;
                ours are named, KYC'd Kenyans, and the same badge here would
                read "Tabitha Chebet holds 5,889 shares of Gachagua" — personal
                financial data about an identified person. Which side is the
                part that lets you discount an argument; the amount adds almost
                nothing to that and a lot to her exposure.

                Colour is not the carrier: the words say "Backs" or "Against",
                so this reads correctly in greyscale and to a screen reader,
                which gets the whole sentence because it cannot see the badge
                sitting next to a name. */}
            {(() => {
              const h = holdings[comment.user_id]
              if (!h) return null
              const d = describeHolding(h, name)
              return (
                <span
                  className={`flex-none rounded px-1.5 py-0.5 text-[11px] font-semibold leading-none ${
                    d.backing ? 'bg-yes/10 text-yes' : 'bg-no/10 text-no'
                  }`}
                  title={d.description}
                >
                  <span className="sr-only">{d.description}. </span>
                  <span aria-hidden>{d.label}</span>
                </span>
              )
            })()}
            <span className="flex-none text-xs text-text-muted">
              {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
            </span>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text-secondary">{comment.content}</p>

          {/* Action row (Polymarket/Twitter-style disclosure):
              • Like (heart + count) is ALWAYS visible — it is the primary
                reaction and the count is meaningful information that must not
                hide. Liking is a one-tap action on every device.
              • Reply + Share fade in on hover / keyboard-focus on desktop (sm+)
                so the thread reads cleanly, and are ALWAYS visible on touch
                (mobile) where there is no hover. They stay in the DOM and reveal
                on focus-within, so the disclosure is keyboard- and
                screen-reader-accessible (WCAG 1.4.13 friendly). */}
          <div className="mt-1.5 flex items-center gap-4 text-xs text-text-muted">
            <button
              type="button"
              onClick={() => toggleLike(comment.id)}
              disabled={pending}
              aria-pressed={liked}
              aria-label={liked ? `Unlike (${comment.like_count})` : 'Like comment'}
              className={`comment-action flex items-center gap-1 transition-colors hover:text-no disabled:opacity-60 ${
                liked ? 'text-no' : ''
              }`}
            >
              <HeartIcon filled={liked} />
              {comment.like_count > 0 && <span className="tabular-nums">{comment.like_count}</span>}
              <span className={comment.like_count > 0 ? 'sr-only' : ''}>Like</span>
            </button>

            <div className="flex items-center gap-4 transition-opacity duration-150 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              <button
                type="button"
                onClick={() => {
                  setReplyingTo((cur) => (cur === comment.id ? null : comment.id))
                  setReplyText('')
                }}
                aria-expanded={replyingTo === comment.id}
                aria-label="Reply to comment"
                className="comment-action flex items-center gap-1 transition-colors hover:text-text-primary"
              >
                <IconComments size={14} />
                Reply
              </button>

              <button
                type="button"
                onClick={() => shareComment(comment.id)}
                aria-label="Share comment"
                className="comment-action flex items-center gap-1 transition-colors hover:text-text-primary"
              >
                <IconShare size={14} />
                Share
              </button>
            </div>
          </div>

          {/* Inline reply composer — parent pinned to the thread root. */}
          {replyingTo === comment.id && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleReply(rootId)
              }}
              className="mt-2 flex gap-2"
            >
              <label htmlFor={`reply-${comment.id}`} className="sr-only">
                Write a reply
              </label>
              <input
                id={`reply-${comment.id}`}
                ref={replyInputRef}
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={`Reply to ${name}…`}
                maxLength={500}
                className="input flex-1"
              />
              <button
                type="submit"
                disabled={replyPending || replyText.trim().length < 2}
                className="btn btn-primary flex-none"
                aria-label="Post reply"
              >
                {replyPending ? <Spinner /> : 'Reply'}
              </button>
            </form>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 max-lg:px-0">
      {/* Tab bar — PM parity: color-only active state (no underline bar, no
          icons), 16px semibold labels, gap-4, horizontally scrollable. */}
      <div role="tablist" aria-label="Community" className="mb-4 flex gap-4 overflow-x-auto">
        {tabs.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              // min-h-11 = 44px (ruling A4); rendered 36px.
              className={`inline-flex min-h-11 flex-none items-center whitespace-nowrap pb-2 pt-1 text-base font-semibold transition-colors ${
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
              {/* Sort control (PM parity — their comments default to "Newest")
                  and the holders filter beside it (matrix C10). */}
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-xs text-text-muted">
                  {comments.length} {comments.length === 1 ? 'comment' : 'comments'}
                </span>
                <div className="flex items-center gap-2">
                  {/* EXTERNAL-LINK WARNING (matrix C10).
                      Polymarket carries a standing "Beware of external links."
                      beside the comment controls. It belongs on any surface
                      where strangers write to people holding money: a market
                      thread is a high-intent audience, and the oldest attack
                      on one is a link to a lookalike wallet or "claim your
                      winnings" page. Static and always visible — a warning
                      that appears only when a link is detected teaches people
                      to trust the threads where it is absent. */}
                  <span className="hidden text-[11px] text-text-muted sm:inline">
                    Beware of external links.
                  </span>
                  {/* HOLDERS FILTER — PM carries one, and it is the natural
                      companion to the badge: once a reader can see who has a
                      position, the next thing they want is to read only those
                      people, or to stop reading them.

                      Hidden when nobody in the thread holds anything, rather
                      than rendering a control that filters to an empty list.
                      44px (ruling A4) — it is a control, not a text link. */}
                  {Object.keys(holdings).length > 0 && (
                    <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-semibold text-text-secondary">
                      <input
                        type="checkbox"
                        checked={holdersOnly}
                        onChange={(e) => setHoldersOnly(e.target.checked)}
                        className="h-4 w-4 accent-[var(--pip-500)]"
                      />
                      Holders
                    </label>
                  )}
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
              </div>

              <div className="space-y-5">
                {threads.map((thread) => (
                  <div key={thread.id}>
                    <CommentBody comment={thread} isReply={false} rootId={thread.id} />
                    {thread.children.length > 0 && (
                      <div className="mt-3 space-y-3 border-l border-hairline pl-4 max-sm:pl-3 sm:ml-4">
                        {thread.children.map((reply) => (
                          <CommentBody key={reply.id} comment={reply} isReply rootId={thread.id} />
                        ))}
                      </div>
                    )}
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
