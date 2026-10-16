// lib/__tests__/comment-page.test.ts
// Paging a comment thread (matrix C11, migration 116).
import { describe, it, expect } from 'vitest'
import {
  COMMENT_PAGE_SIZE,
  toCommentPage,
  cursorFrom,
  mergeComments,
  remainingRoots,
  type CommentPageRow,
  type ThreadComment,
} from '../markets/comment-page'

/** A row exactly as `market_comments_page` returns one. */
const row = (o: Partial<CommentPageRow> = {}): CommentPageRow => ({
  id: 'c1',
  market_id: 'm1',
  user_id: 'u1',
  parent_id: null,
  content: 'Ruto takes it',
  like_count: 3,
  created_at: '2026-07-20T23:58:33.184283Z',
  is_reply: false,
  author_display_name: 'Grace Simiyu',
  author_username: 'grace.si',
  author_avatar_url: null,
  total_roots: 34,
  total_comments: 36,
  ...o,
})

const c = (id: string, created_at: string, parent_id: string | null = null): ThreadComment => ({
  id,
  market_id: 'm1',
  user_id: 'u1',
  parent_id,
  content: 'x',
  like_count: 0,
  created_at,
})

describe('toCommentPage', () => {
  it('re-nests the flattened author the renderer expects', () => {
    const p = toCommentPage([row()], true)
    expect(p.comments[0].user).toEqual({
      id: 'u1',
      display_name: 'Grace Simiyu',
      username: 'grace.si',
      avatar_url: null,
    })
    expect(p.comments[0].like_count).toBe(3)
  })

  it('reads BIGINT counts that arrived as strings', () => {
    // total_roots/total_comments are BIGINT and like_count is INT; supabase-js
    // hands BIGINT back as a string often enough that the naive version put
    // "Show NaN more" on the button.
    const p = toCommentPage([row({ total_roots: '34', total_comments: '36', like_count: '3' })], true)
    expect(p.totalRoots).toBe(34)
    expect(p.totalComments).toBe(36)
    expect(p.comments[0].like_count).toBe(3)
  })

  it('separates the two counts, because replies are not roots', () => {
    // 34 roots drives "Show N more"; 36 drives "Comments (36)". Conflating
    // them undercounts every thread by the number of replies in it.
    const p = toCommentPage([row()], true)
    expect(p.totalRoots).not.toBe(p.totalComments)
  })

  it('drops a row it cannot render rather than taking the thread down', () => {
    // formatDistanceToNow(new Date(null)) throws on an Invalid Date, and it is
    // called inside the row — so one bad row would blank the whole thread.
    expect(toCommentPage([row({ created_at: null })], true).comments).toEqual([])
    expect(toCommentPage([row({ created_at: 'not-a-date' })], true).comments).toEqual([])
    expect(toCommentPage([row({ id: null })], true).comments).toEqual([])
    expect(toCommentPage([row({ user_id: null })], true).comments).toEqual([])
    expect(toCommentPage(null, true).comments).toEqual([])
  })

  it('still reports the counts when every row was dropped', () => {
    // Otherwise a page of unrenderable rows reads as "thread is empty" and the
    // tab label loses the count it already had.
    const p = toCommentPage([row({ created_at: null })], true)
    expect(p.totalRoots).toBe(34)
  })

  it('keeps a null content as empty, not as a dropped row', () => {
    expect(toCommentPage([row({ content: null })], true).comments[0].content).toBe('')
  })
})

describe('cursorFrom', () => {
  it('takes the last root in DISPLAY order, which flips with the sort', () => {
    const rows = [c('a', '2026-07-01T00:00:00Z'), c('b', '2026-07-03T00:00:00Z')]
    // newest-first: the page ends on the OLDEST row, so that is the cursor.
    expect(cursorFrom(rows, true)?.id).toBe('a')
    // oldest-first: it ends on the newest.
    expect(cursorFrom(rows, false)?.id).toBe('b')
  })

  it('breaks a timestamp tie on id, in the same direction as the sort', () => {
    // THE MEASUREMENT THIS EXISTS FOR: 216 live comments carry only 125
    // distinct timestamps, and up to THREE comments in one market share a
    // timestamp to the microsecond. A cursor on created_at alone would skip or
    // duplicate every row in a tie group straddling a page boundary.
    const t = '2026-07-20T23:58:33.184283Z'
    const rows = [c('b-mid', t), c('a-low', t), c('c-high', t)]
    expect(cursorFrom(rows, true)?.id).toBe('a-low')
    expect(cursorFrom(rows, false)?.id).toBe('c-high')
  })

  it('ignores replies, whose timestamps run past their root', () => {
    // A reply is always newer than the root it answers, so using one as the
    // cursor in a newest-first walk would page past unseen roots.
    const rows = [
      c('root', '2026-07-01T00:00:00Z'),
      c('reply', '2026-07-09T00:00:00Z', 'root'),
    ]
    expect(cursorFrom(rows, true)?.id).toBe('root')
    expect(cursorFrom(rows, false)?.id).toBe('root')
  })

  it('treats an orphan as a root, because migration 116 does', () => {
    // When a moderator takes down a root, its replies bubble up to top level
    // (014 sets is_deleted on one row with no cascade). An orphan is a root on
    // screen, so it must be a root for paging or the walk stalls on it.
    const rows = [c('orphan', '2026-07-02T00:00:00Z', 'taken-down-parent')]
    expect(cursorFrom(rows, true)?.id).toBe('orphan')
  })

  it('is null for an empty page, which is how the caller knows to stop', () => {
    expect(cursorFrom([], true)).toBeNull()
    // A page of replies only cannot advance the walk either.
    expect(cursorFrom([c('r', '2026-07-01T00:00:00Z', 'root')].map((x) => ({ ...x })), true)?.id).toBe('r')
  })
})

describe('mergeComments', () => {
  it('is keyed by id, so a row arriving twice renders once', () => {
    // The viewer's own post is absorbed by the insert handler AND by the
    // realtime event the same insert raises; a page can also re-deliver a row
    // that realtime already added.
    const a = c('x', '2026-07-01T00:00:00Z')
    const merged = mergeComments([a], [{ ...a, content: 'edited' }])
    expect(merged).toHaveLength(1)
    expect(merged[0].content).toBe('edited')
  })

  it('returns the previous array untouched when nothing arrived', () => {
    // So an empty page does not force a re-render of the whole thread.
    const prev = [c('x', '2026-07-01T00:00:00Z')]
    expect(mergeComments(prev, [])).toBe(prev)
  })

  it('keeps everything from both sides', () => {
    const merged = mergeComments([c('a', '2026-07-01T00:00:00Z')], [c('b', '2026-07-02T00:00:00Z')])
    expect(merged.map((m) => m.id).sort()).toEqual(['a', 'b'])
  })
})

describe('remainingRoots', () => {
  it('counts roots, not rows: replies are never behind the button', () => {
    const loaded = [
      c('r1', '2026-07-01T00:00:00Z'),
      c('r2', '2026-07-02T00:00:00Z'),
      c('y1', '2026-07-03T00:00:00Z', 'r1'),
    ]
    // 34 roots on the market, 2 loaded -> 32 left. Counting the reply as
    // loaded progress would say 31 and the last press would come up short.
    expect(remainingRoots(loaded, 34)).toBe(32)
  })

  it('counts an orphan as a loaded root', () => {
    const loaded = [c('o', '2026-07-01T00:00:00Z', 'gone')]
    expect(remainingRoots(loaded, 34)).toBe(33)
  })

  it('is null when the server sent no count, so the label stays honest', () => {
    // "Show more comments" is right when we do not know; "Show 0 more" is a
    // confident wrong number.
    expect(remainingRoots([c('a', '2026-07-01T00:00:00Z')], null)).toBeNull()
  })

  it('never goes negative when realtime has run ahead of the count', () => {
    const loaded = [c('a', '2026-07-01T00:00:00Z'), c('b', '2026-07-02T00:00:00Z')]
    expect(remainingRoots(loaded, 1)).toBe(0)
  })
})

describe('COMMENT_PAGE_SIZE', () => {
  it('is the page size the measurement derives', () => {
    // 2,743 px of page without the thread, a third of the document as the
    // budget, 67 px a row: 1,371 / 67 = 20. Pinned so a later "let us just
    // show more" has to argue with the number.
    expect(COMMENT_PAGE_SIZE).toBe(20)
  })
})
