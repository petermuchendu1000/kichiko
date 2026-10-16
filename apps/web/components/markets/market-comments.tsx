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
import {
  COMMENT_PAGE_SIZE,
  toCommentPage,
  mergeComments,
  remainingRoots,
  type ThreadComment,
  type CommentPageRow,
  type CommentCursor,
} from '@/lib/markets/comment-page'
import { MarketPositions } from '@/components/markets/market-positions'
import toast from 'react-hot-toast'
import type { MarketOption } from '@/types'

type TabKey = 'comments' | 'holders' | 'positions' | 'activity'
type CommentSort = 'newest' | 'oldest'

// A comment plus its (already-resolved) direct replies. Built client-side from
// the flat fetch so rendering is a simple two-level walk.
type CommentNode = ThreadComment & { children: ThreadComment[] }

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
  // `comments` is the flat LOADED set: the pages fetched so far (roots plus
  // their replies), not the whole thread. Matrix C11 — see lib/markets/
  // comment-page.ts for what the whole thread used to cost.
  const [comments, setComments] = useState<ThreadComment[]>([])
  /** Total ROOTS on the market, from the server. Null until a page answers. */
  const [totalRoots, setTotalRoots] = useState<number | null>(null)
  /** Total comments including replies — the "Comments (N)" label. */
  const [totalComments, setTotalComments] = useState<number | null>(null)
  /** The last page came back empty: there is nothing further to ask for. */
  const [exhausted, setExhausted] = useState(false)
  const [isPaging, setIsPaging] = useState(false)
  /** The page request failed — distinct from the thread being empty. */
  const [loadFailed, setLoadFailed] = useState(false)
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

  // Which "liked by me" rows have already been looked up, so paging in more
  // comments asks only about the new ids instead of re-asking about all of them.
  const likesSeen = useRef<Set<string>>(new Set())
  // Mutable mirrors of state the realtime handler must read without being
  // rebuilt. Declared before the callbacks that close over them.
  const sortRef = useRef<CommentSort>(sort)
  const cursorRef = useRef<CommentCursor | null>(null)
  const exhaustedRef = useRef(false)
  const holdingsSeen = useRef<Set<string>>(new Set())
  const absorbed = useRef<Set<string>>(new Set())
  /** The loaded set, for effects that must read it without depending on it. */
  const commentsRef = useRef<ThreadComment[]>([])

  /** Seed/extend "liked by me" for ids we have not asked about yet. */
  const seedLikes = useCallback(
    async (rows: readonly ThreadComment[]) => {
      if (!user) {
        likesSeen.current = new Set()
        setLikedIds(new Set())
        return
      }
      const ids = rows.map((c) => c.id).filter((id) => !likesSeen.current.has(id))
      if (!ids.length) return
      for (const id of ids) likesSeen.current.add(id)
      const { data: likeRows } = await supabase
        .from('comment_likes' as never)
        .select('comment_id')
        .eq('user_id', user.id)
        .in('comment_id', ids)
      const got = ((likeRows as { comment_id: string }[] | null) || []).map((r) => r.comment_id)
      if (got.length) setLikedIds((prev) => new Set([...prev, ...got]))
    },
    [supabase, user],
  )

  /**
   * Fetch ONE page of the thread (matrix C11, migration 116).
   *
   * `reset` starts from the newest/oldest end — on mount, and whenever the sort
   * direction changes, because a cursor into a descending walk means nothing in
   * an ascending one.
   */
  const loadPage = useCallback(
    async (reset: boolean) => {
      const newest = sortRef.current === 'newest'
      const cursor = reset ? null : cursorRef.current
      if (reset) {
        cursorRef.current = null
        setIsLoading(true)
      } else {
        setIsPaging(true)
      }

      const { data, error } = await supabase.rpc('market_comments_page' as never, {
        p_market_id: marketId,
        p_limit: COMMENT_PAGE_SIZE,
        p_cursor_at: cursor?.at ?? null,
        p_cursor_id: cursor?.id ?? null,
        p_newest: newest,
      } as never)

      const page = toCommentPage((data as unknown as CommentPageRow[]) ?? [], newest)
      setLoadFailed(!!error)
      if (!error) {
        // A page with no roots is the end of the thread; keep the cursor where
        // it was so "Show more" cannot loop on an empty answer.
        if (page.cursor) cursorRef.current = page.cursor
        setExhausted(!page.cursor)
        if (page.totalRoots !== null) setTotalRoots(page.totalRoots)
        if (page.totalComments !== null) setTotalComments(page.totalComments)
        setComments((prev) => (reset ? page.comments : mergeComments(prev, page.comments)))
        void seedLikes(page.comments)
      }
      setIsLoading(false)
      setIsPaging(false)
    },
    [supabase, marketId, seedLikes],
  )

  /**
   * Absorb a single newly-posted comment.
   *
   * This is the whole point of C11. The old subscription called the
   * whole-thread fetch on every INSERT for every open viewer — measured at
   * 22,916 B per viewer for one 58-character comment, growing with the thread.
   * One row is ~500 B and is O(1) in thread length.
   */
  const absorbRow = useCallback(
    async (commentId: string, force: boolean) => {
      // The viewer's OWN post is absorbed twice: once by the insert handler
      // that has the id, and again by the realtime event the same insert
      // raises. Without this guard the totals bump twice for one comment.
      // Claimed before the fetch so the duplicate round trip is skipped too,
      // and released on failure so a later event can still retry.
      if (absorbed.current.has(commentId)) return
      absorbed.current.add(commentId)

      const { data } = await supabase
        .from('comments')
        .select('id, market_id, user_id, parent_id, content, like_count, created_at, user:profiles!comments_user_id_fkey(id, display_name, avatar_url, username)')
        .eq('id', commentId)
        .eq('is_deleted', false)
        .maybeSingle()
      const row = data as unknown as ThreadComment | null
      if (!row?.id) {
        absorbed.current.delete(commentId)
        return
      }

      const isRoot = !row.parent_id
      // The counts are the server's, so bump them for a row we were told about
      // — whether or not we display it — and the labels stay truthful.
      if (isRoot) setTotalRoots((n) => (n === null ? n : n + 1))
      setTotalComments((n) => (n === null ? n : n + 1))

      // Does it belong in the window the reader is looking at?
      //  - newest-first: always, it IS the newest.
      //  - oldest-first: only once the end of the thread is loaded, otherwise
      //    it would appear directly beneath the 20 OLDEST comments, above the
      //    older ones still behind "Show more". It is counted above and arrives
      //    in its proper place when the reader pages to the end.
      //  - `force` for the viewer's own post: hiding what someone just wrote
      //    reads as a failure to post.
      const belongs = force || sortRef.current === 'newest' || exhaustedRef.current
      if (!belongs) return

      setComments((prev) => mergeComments(prev, [row]))
      void seedLikes([row])

      // Badges come from their own RPC and only change when someone who has
      // never commented here comments. Re-running it per INSERT was half the
      // measured amplification (3,440 B a viewer) for an answer that is
      // usually identical.
      if (row.user_id && !holdingsSeen.current.has(row.user_id)) {
        holdingsSeen.current.add(row.user_id)
        void supabase
          .rpc('market_comment_holdings' as never, {
            // ONE user (migration 117): ~150 B instead of the 3,440 B the
            // whole board costs, to learn one person's side.
            p_market_id: marketId,
            p_user_id: row.user_id,
          } as never)
          .then(({ data: hRows }) => {
            const one = toHoldingMap((hRows as unknown as HoldingRow[]) ?? [])
            // MERGE. This answer covers one user, so assigning it would wipe
            // the badge off every other commenter in the thread.
            setHoldings((prev) => ({ ...prev, ...one }))
          })
      }
    },
    [supabase, marketId, seedLikes],
  )

  // Keep the realtime handler's view of sort/paging state current without
  // resubscribing: a channel torn down and rebuilt on every sort change drops
  // events in the gap.
  const absorbRef = useRef(absorbRow)
  sortRef.current = sort
  exhaustedRef.current = exhausted
  absorbRef.current = absorbRow
  commentsRef.current = comments

  /**
   * Re-seed "liked by me" when the viewer signs in or out.
   *
   * A REGRESSION THIS FIXES RATHER THAN A NICETY. The old whole-thread fetch
   * sat in an effect that depended on it, and it depended on `user`, so
   * signing in refetched everything and the hearts came back filled. The page
   * effect is now guarded on market+sort precisely so that signing in does NOT
   * throw away the pages someone has already asked for — which means nothing
   * was left to notice the sign-in, and every heart would have stayed empty
   * until a reload. The loaded set is read through a ref so this depends on
   * the identity and not on the thread.
   */
  useEffect(() => {
    likesSeen.current = new Set()
    setLikedIds(new Set())
    if (user) void seedLikes(commentsRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  /**
   * First page, re-paged when the market or the sort direction changes.
   *
   * ONE effect guarded by a key, not a mount effect plus a "skip the first
   * run" flag. Measured: that shape fired the page RPC THREE times on load.
   * React's StrictMode runs effects twice on mount but does NOT reset refs
   * between the two passes, so the `firstSort` flag was already false on the
   * second pass and the sort effect loaded a page it was written never to load
   * on mount. Comparing against the key that was actually loaded cannot
   * double-fire however many times the effect runs.
   */
  const loadedKey = useRef<string | null>(null)
  const loadedMarket = useRef<string | null>(null)
  useEffect(() => {
    const key = `${marketId}|${sort}`
    if (loadedKey.current === key) return
    loadedKey.current = key

    if (loadedMarket.current !== marketId) {
      loadedMarket.current = marketId
      cursorRef.current = null
      holdingsSeen.current = new Set()
      likesSeen.current = new Set()
      absorbed.current = new Set()
      // The badge lookup is per market, not per page: it answers for every
      // commenter at once, so paging in more comments needs no second call.
      void supabase
        .rpc('market_comment_holdings' as never, { p_market_id: marketId } as never)
        .then(({ data: hRows }) => {
          const map = toHoldingMap((hRows as unknown as HoldingRow[]) ?? [])
          setHoldings(map)
          // Remember who we have an answer for, including the people who hold
          // nothing — otherwise every comment by a non-holder re-asks.
          for (const id of Object.keys(map)) holdingsSeen.current.add(id)
        })
    }
    void loadPage(true)
    // loadPage is intentionally not a dependency: its identity changes with
    // `user`, and re-running the first page because somebody signed in would
    // throw away the pages they had already asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId, sort, supabase])

  // One subscription per market, never rebuilt. The handler goes through a ref
  // so it always sees current state.
  useEffect(() => {
    const channel = supabase
      .channel(`comments:${marketId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'comments', filter: `market_id=eq.${marketId}` },
        (payload) => {
          const id = (payload.new as { id?: string } | null)?.id
          if (id) void absorbRef.current(id, false)
        },
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [marketId, supabase])

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
    // `.select('id')` so the new row can be absorbed on its own. The realtime
    // event for this insert will arrive too and merge to the same id.
    const { data, error } = await supabase
      .from('comments')
      .insert({ market_id: marketId, user_id: user.id, content })
      .select('id')
      .maybeSingle()
    if (error) {
      toast.error('Failed to post comment')
    } else {
      setNewComment('')
      const id = (data as { id?: string } | null)?.id
      // force: the viewer's own comment is shown whatever the sort and
      // whatever is still behind "Show more".
      if (id) await absorbRow(id, true)
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
    const { data, error } = await supabase
      .from('comments')
      .insert({ market_id: marketId, user_id: user.id, parent_id: rootId, content })
      .select('id')
      .maybeSingle()
    if (error) {
      toast.error('Failed to post reply')
    } else {
      setReplyText('')
      setReplyingTo(null)
      const id = (data as { id?: string } | null)?.id
      if (id) await absorbRow(id, true)
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
    const byId = new Map<string, ThreadComment>()
    for (const c of comments) byId.set(c.id, c)

    // The holders filter keeps a ROOT when the root's author holds, or when
    // any reply under it does — so turning it on narrows the thread list
    // rather than shredding conversations into orphaned halves. A reply by a
    // holder is still worth reading in the context of the question it answers.
    const holderIds = new Set(Object.keys(holdings))
    const keepRoot = (c: ThreadComment): boolean => {
      if (!holdersOnly) return true
      if (holderIds.has(c.user_id)) return true
      return comments.some((r) => r.parent_id === c.id && holderIds.has(r.user_id))
    }

    const childrenOf = new Map<string, ThreadComment[]>()
    const roots: ThreadComment[] = []
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

  /** Roots the reader has not been shown yet, for the "Show N more" label. */
  const hiddenRoots = useMemo(() => remainingRoots(comments, totalRoots), [comments, totalRoots])

  const tabs: { key: TabKey; label: string }[] = [
    // PM shows the count in parens with a thousands separator: "Comments (3,993)".
    // The count is the SERVER's total, not the loaded page — labelling a
    // 500-comment thread "Comments (20)" because that is what we fetched would
    // be a plain lie about the market's activity.
    { key: 'comments', label: `Comments${totalComments ? ` (${totalComments.toLocaleString('en-US')})` : ''}` },
    { key: 'holders', label: 'Top Holders' },
    { key: 'positions', label: 'Positions' },
    { key: 'activity', label: 'Activity' },
  ]

  // ---- one comment (used for both roots and replies) ----------------------
  function CommentBody({ comment, isReply, rootId }: { comment: ThreadComment; isReply: boolean; rootId: string }) {
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
            /* A FAILED FETCH IS NOT AN EMPTY THREAD. Both render as zero rows,
               and saying "be the first" to someone looking at a market with
               500 comments is a plain falsehood that also invites them to
               duplicate a conversation they cannot see. Pre-existing — the old
               whole-thread fetch discarded its error the same way — and fixed
               here because paging made the failure path worth naming. */
            loadFailed ? (
              <EmptyState>
                Couldn’t load the comments.{' '}
                <button
                  type="button"
                  onClick={() => void loadPage(true)}
                  className="font-semibold text-text-primary underline underline-offset-2"
                >
                  Try again
                </button>
              </EmptyState>
            ) : (
              <EmptyState>No comments yet. Be the first to share your prediction.</EmptyState>
            )
          ) : (
            <>
              {/* Sort control (PM parity — their comments default to "Newest")
                  and the holders filter beside it (matrix C10). */}
              {/* flex-wrap, so the warning below can take its own line on a
                  narrow viewport instead of being hidden on one. */}
              <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-xs text-text-muted">
                  {(totalComments ?? comments.length).toLocaleString('en-US')}{' '}
                  {(totalComments ?? comments.length) === 1 ? 'comment' : 'comments'}
                </span>
                {/* EXTERNAL-LINK WARNING (matrix C10).
                      Polymarket carries a standing "Beware of external links."
                      beside the comment controls. It belongs on any surface
                      where strangers write to people holding money: a market
                      thread is a high-intent audience, and the oldest attack
                      on one is a link to a lookalike wallet or "claim your
                      winnings" page. Static and always visible — a warning
                      that appears only when a link is detected teaches people
                      to trust the threads where it is absent.

                      IT WAS `hidden sm:inline` AND THAT WAS BACKWARDS. The
                      mobile a11y run caught it: the warning was suppressed
                      below 640px, which is the viewport where a lookalike link
                      is hardest to spot — no hover preview of the href, and a
                      truncated address bar. It was hidden to save a crowded
                      row, so the row now wraps on mobile and the warning sits
                      on its own line beneath the controls instead.

                      ONE copy of the string, not a desktop span plus a mobile
                      span: two copies of a safety warning drift apart, and the
                      test would only ever read whichever came first in the
                      DOM. `ml-auto` puts it beside the controls on desktop
                      exactly as before; on mobile it takes the full width of
                      the second line. */}
                <span className="text-[11px] text-text-muted max-sm:order-last max-sm:ml-0 max-sm:w-full sm:ml-auto">
                  Beware of external links.
                </span>
                <div className="flex items-center gap-2 max-sm:ml-auto">
                  {/* HOLDERS FILTER — PM carries one, and it is the natural
                      companion to the badge: once a reader can see who has a
                      position, the next thing they want is to read only those
                      people, or to stop reading them.

                      Hidden when nobody in the thread holds anything, rather
                      than rendering a control that filters to an empty list.

                      44px (ruling A4) — it is a control, not a text link. The
                      first cut put `min-h-11` on this LABEL and left the input
                      at `h-4 w-4`, which reads as compliant and is not: A4's
                      gate measures each CONTROL's own box, and a native
                      checkbox IS the control, so `e2e/target-size.spec.ts`
                      reported `INPUT — 16x16` on this money route. Pointer
                      events go to the input, not the label, so the ruling was
                      being applied to the wrong element.

                      So the input becomes a transparent 44x44 target laid over
                      the box, and the box is drawn by the span beside it. That
                      is the only way to keep a 16px checkbox and a 44px target
                      at once: `transform: scale()` cannot do it, because
                      getBoundingClientRect reports the SCALED box and the gate
                      would read the shrunken number.

                      The 44px is centred on the BOX, via a `relative` wrapper
                      that is exactly the box's size — not on the label. The
                      first attempt anchored it to the label, whose centre sits
                      over the word "Holders", so the target measured 44x44 and
                      sat several pixels to the right of the thing being
                      aimed at. A4's gate reads sizes, not positions, and
                      passed it; the finger would not have. */}
                  {Object.keys(holdings).length > 0 && (
                    <label className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-semibold text-text-secondary">
                      <span className="relative grid size-4 flex-none place-items-center">
                        <input
                          type="checkbox"
                          checked={holdersOnly}
                          onChange={(e) => setHoldersOnly(e.target.checked)}
                          className="peer absolute left-1/2 top-1/2 size-11 -translate-x-1/2 -translate-y-1/2 cursor-pointer opacity-0"
                        />
                        <span
                          aria-hidden
                          // text-TRANSPARENT until checked, not text-white: the
                          // tick is always in the DOM and only the box changes
                          // on :checked, so a white tick on an unchecked box is
                          // invisible on the light surface and plainly visible
                          // on the dark one — the control read as permanently
                          // ticked in dark mode. Light hid the defect, which is
                          // why it survived; both themes are now explicit.
                          className="grid size-4 place-items-center rounded-[3px] border border-hairline text-transparent transition-colors peer-checked:border-[var(--pip-500)] peer-checked:bg-[var(--pip-500)] peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-pip-500/40"
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path
                              d="M1.5 5.2 3.9 7.5 8.5 2.5"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                      </span>
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

              {/* SHOW MORE (matrix C11, migration 116).
                  Polymarket's own affordance, measured: a centred full-width
                  button at the tail of the list (div.flex.justify-center.w-full
                  .py-4, 72 px), not infinite scroll. An explicit press is the
                  right call for a thread — infinite scroll on a comment list
                  traps a keyboard or screen-reader user trying to reach what
                  follows it, and on this page what follows is the rules and
                  the resolution source.

                  Says how many are left, because "Show more" alone cannot tell
                  a reader whether one press ends the thread or forty do. Falls
                  back to a bare "Show more comments" when the server did not
                  return a count, rather than printing a confident wrong one.
                  min-h-11 = 44px (ruling A4).

                  HIDDEN WHEN NOTHING IS LEFT, not relabelled. Measured: with
                  only `!exhausted` guarding it, pressing it on the last
                  partial page left a button reading "Show more comments"
                  (hiddenRoots had fallen to 0, so the label fell through to
                  its unknown-count branch) whose next press fetched an empty
                  page to learn what the count already said. `exhausted` still
                  guards the case where the server returned no count at all. */}
              {!exhausted && (hiddenRoots === null || hiddenRoots > 0) && (
                <div className="flex w-full justify-center pt-4">
                  <button
                    type="button"
                    onClick={() => void loadPage(false)}
                    disabled={isPaging}
                    className="inline-flex min-h-11 items-center gap-2 rounded-sm px-4 text-sm font-semibold text-text-secondary transition-colors hover:text-text-primary disabled:opacity-60"
                  >
                    {isPaging ? (
                      <>
                        <Spinner />
                        Loading…
                      </>
                    ) : hiddenRoots !== null && hiddenRoots > 0 ? (
                      `Show ${hiddenRoots.toLocaleString('en-US')} more`
                    ) : (
                      'Show more comments'
                    )}
                  </button>
                </div>
              )}
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
