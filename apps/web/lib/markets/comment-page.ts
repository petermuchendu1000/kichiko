// lib/markets/comment-page.ts
// ---------------------------------------------------------------------------
// One page of a comment thread (matrix C11, migration 116).
//
// WHAT WAS WRONG, MEASURED 2026-10-16
//
// The thread was fetched whole — `.limit(500)` — and the realtime
// subscription re-ran that fetch on every INSERT, for every open viewer. Two
// browsers on /markets/ke-2027-president, one 58-character comment inserted
// out-of-band:
//
//   viewer A : comments 19,476 B (37 rows) + market_comment_holdings 3,440 B
//   viewer B : identical — 22,916 B each
//
// 395x the content of the comment that caused it, per viewer, growing with the
// length of the thread. Idle cost was correctly zero, so the defect is purely
// the amplification on write.
//
// Polymarket, measured the same day on `brazil-presidential-election`
// (24,024 comments): `limit=10&offset=0`, exactly ONE comments request in the
// page's lifetime, no realtime stream of the thread, and the rest behind a
// "Show more" button. Their first page is 27,859 B and 33.9% of the document.

import type { Comment, Profile } from '@/types'

/**
 * Roots per page.
 *
 * DERIVED, NOT PICKED. Measured on /markets/ke-2027-president at 1440x900:
 * the thread was 3,087 px of a 5,830 px document (52.9%), so the page without
 * it is 2,743 px, and a root row averages 67 px.
 *
 * Polymarket's first page is 33.9% of their document. For ours to sit at or
 * under a third, the thread may occupy 2,743 / 2 = 1,371 px, which at 67 px a
 * row is 20 roots. 20 roots is also ~11 KB against Polymarket's 27,859 B
 * first page, so this is the smaller payload of the two.
 *
 * It is NOT their 10, because their 10 is a sample of 24,024 nobody intends to
 * read, while 20 of our current maximum of 34 roots means one press of "Show
 * more" reveals the whole thread. The row height is an average of 47-character
 * comments; longer comments make rows taller, so the pixel budget is nominal
 * while the payload bound is exact.
 */
export const COMMENT_PAGE_SIZE = 20

/**
 * The subset of a comment the thread actually renders.
 *
 * Deliberately not `Comment`: migration 116 returns these columns and no
 * others, so typing the paged row as a full `Comment` would claim
 * `report_count`, `is_flagged`, `updated_at` and `is_deleted` are present when
 * they are not. Every field below is one `CommentBody` reads.
 */
export type ThreadComment = Pick<
  Comment,
  'id' | 'market_id' | 'user_id' | 'parent_id' | 'content' | 'like_count' | 'created_at'
> & {
  user?: Pick<Profile, 'id' | 'display_name' | 'avatar_url' | 'username'> | null
}

/** A row exactly as `market_comments_page` returns it. */
export interface CommentPageRow {
  id: string | null
  market_id: string | null
  user_id: string | null
  parent_id: string | null
  content: string | null
  like_count: number | string | null
  created_at: string | null
  is_reply: boolean | null
  author_display_name: string | null
  author_username: string | null
  author_avatar_url: string | null
  total_roots: number | string | null
  total_comments: number | string | null
}

/** A cursor into the thread: the composite keyset of the last root on a page. */
export interface CommentCursor {
  at: string
  id: string
}

export interface CommentPage {
  comments: ThreadComment[]
  /** Total ROOTS on the market, from the server — not the loaded count. */
  totalRoots: number | null
  /** Total comments INCLUDING replies, for the "Comments (N)" label. */
  totalComments: number | null
  /** Pass back as the cursor to get the next page; null when the page is empty. */
  cursor: CommentCursor | null
}

/**
 * Shape a page.
 *
 * The author fields arrive flattened (a SQL function returns a flat TABLE) and
 * are re-nested into the `user` the renderer expects. A row missing an id, an
 * author or a timestamp is dropped rather than rendered: `new Date(null)` is
 * an Invalid Date and `formatDistanceToNow` throws on it, which would take the
 * whole thread down over one bad row.
 *
 * `like_count` and `total_roots` are read through Number() because NUMERIC and
 * BIGINT both arrive from supabase-js as strings — the trap that printed
 * "+NaN" in option-delta and compared "30730" with "30730.00" in pnl-range.
 */
export function toCommentPage(
  rows: readonly CommentPageRow[] | null | undefined,
  newestFirst: boolean,
): CommentPage {
  const comments: ThreadComment[] = []
  let totalRoots: number | null = null
  let totalComments: number | null = null

  for (const r of rows ?? []) {
    if (totalRoots === null && r?.total_roots !== null && r?.total_roots !== undefined) {
      const n = Number(r.total_roots)
      if (Number.isFinite(n)) totalRoots = n
    }
    if (totalComments === null && r?.total_comments !== null && r?.total_comments !== undefined) {
      const n = Number(r.total_comments)
      if (Number.isFinite(n)) totalComments = n
    }
    if (!r?.id || !r.user_id || !r.created_at || !r.market_id) continue
    if (Number.isNaN(new Date(r.created_at).getTime())) continue
    const likes = Number(r.like_count)
    comments.push({
      id: r.id,
      market_id: r.market_id,
      user_id: r.user_id,
      parent_id: r.parent_id ?? null,
      content: r.content ?? '',
      like_count: Number.isFinite(likes) ? likes : 0,
      created_at: r.created_at,
      user: {
        id: r.user_id,
        display_name: r.author_display_name,
        username: r.author_username,
        avatar_url: r.author_avatar_url,
      },
    })
  }

  return { comments, totalRoots, totalComments, cursor: cursorFrom(comments, newestFirst) }
}

/**
 * The keyset to ask for the next page with: the LAST root in display order.
 *
 * Replies are excluded — they are not paged, and a reply's timestamp is later
 * than its root's, so using one as the cursor would skip roots.
 *
 * The cursor is composite because created_at alone is not unique: measured,
 * 216 live comments carry 125 distinct timestamps, with up to three comments
 * in one market sharing a timestamp to the microsecond. A created_at-only
 * cursor would skip or duplicate rows at any boundary inside a tie group.
 */
export function cursorFrom(
  comments: readonly ThreadComment[],
  newestFirst: boolean,
): CommentCursor | null {
  const rootIds = new Set(comments.filter((c) => !c.parent_id).map((c) => c.id))
  // A reply whose parent is not in this page is an orphan that migration 116
  // bubbled up to root level, so it is a root for paging purposes too.
  const roots = comments.filter((c) => !c.parent_id || !rootIds.has(c.parent_id))
  if (!roots.length) return null

  let last = roots[0]
  for (const c of roots) {
    const a = new Date(c.created_at).getTime()
    const b = new Date(last.created_at).getTime()
    // Later in DISPLAY order: oldest for newest-first, newest for oldest-first.
    if (a === b ? (newestFirst ? c.id < last.id : c.id > last.id) : newestFirst ? a < b : a > b) {
      last = c
    }
  }
  return { at: last.created_at, id: last.id }
}

/**
 * Add rows to the loaded set, newest-wins on id.
 *
 * Needed in three places that can race: the next page, a realtime INSERT, and
 * the viewer's own post. Keyed by id so a row arriving twice — a realtime
 * event for a comment the next page also contains — renders once.
 */
export function mergeComments(
  prev: readonly ThreadComment[],
  incoming: readonly ThreadComment[],
): ThreadComment[] {
  if (!incoming.length) return prev as ThreadComment[]
  const byId = new Map<string, ThreadComment>()
  for (const c of prev) byId.set(c.id, c)
  for (const c of incoming) byId.set(c.id, c)
  return [...byId.values()]
}

/**
 * How many roots are still unseen, for the "Show N more" label.
 *
 * Returns null when the total is unknown (the RPC answered without a count),
 * so the caller can say "Show more" rather than a confident wrong number.
 */
export function remainingRoots(
  loaded: readonly ThreadComment[],
  totalRoots: number | null,
): number | null {
  if (totalRoots === null) return null
  const ids = new Set(loaded.map((c) => c.id))
  const roots = loaded.filter((c) => !c.parent_id || !ids.has(c.parent_id)).length
  return Math.max(0, totalRoots - roots)
}
