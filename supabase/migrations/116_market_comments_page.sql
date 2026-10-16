-- 116_market_comments_page.sql
-- ---------------------------------------------------------------------------
-- One page of a comment thread, assembled server-side.
--
-- WHY (matrix C11, measured 2026-10-16)
--
-- The thread was fetched whole, every time, by everyone:
--
--     .eq('market_id', marketId).eq('is_deleted', false).limit(500)
--
-- and the realtime subscription re-ran that same fetch on every INSERT, for
-- every connected viewer. Measured on /markets/ke-2027-president with two
-- browsers open and ONE 58-character comment inserted out-of-band:
--
--   viewer A : comments 19,476 B (37 rows) + market_comment_holdings 3,440 B
--   viewer B : identical — 22,916 B each, 45,832 B for the pair
--
-- That is 395x the content of the comment that caused it, per viewer, and it
-- grows with the length of the thread: cost is O(thread x viewers) for an
-- event that changed one row. Idle cost was correctly zero (no polling), so
-- the defect is purely the amplification on write.
--
-- Polymarket, measured the same day on `brazil-presidential-election`
-- (24,024 comments, the direct analogue of ke-2027-president):
--
--   * their client asks for `limit=10&offset=0&order=createdAt&ascending=false`
--   * exactly ONE comments request in the page's lifetime — no polling, and
--     no realtime stream of the thread at all
--   * the remaining 24,014 sit behind an explicit "Show more" button
--     (`div.flex.justify-center.w-full.py-4`, 72 px) at the tail of the list
--   * the first page is 27,859 B and occupies 1,476 px of a 4,359 px
--     document — 33.9% of the page
--
-- Ours rendered all 36 roots+replies: 3,087 px of a 5,830 px document, 52.9%.
--
-- WHY A FUNCTION AND NOT TWO CLIENT QUERIES
--
-- The honest alternative was `.is('parent_id', null)` for a page of roots plus
-- `.in('parent_id', ids)` for their replies — two round trips, no migration.
-- It breaks on a real moderation action.
--
-- `comments` RLS is `is_deleted = FALSE OR is_admin()` (001, line 1310) and
-- admin take-down sets `is_deleted` on ONE comment with no cascade to its
-- replies (014, line 347). So when a moderator removes a root, its replies
-- still point at a row the reader cannot see. The client has always bubbled
-- those up to top level so a reply never silently vanishes — and a root page
-- filtered on `parent_id IS NULL` would miss exactly them, turning a
-- take-down into the deletion of every reply under it.
--
-- Expressed in SQL the rule is simply "no VISIBLE parent", and because this
-- function is SECURITY INVOKER, RLS does that work itself: the invisible
-- parent is not found, so the reply is a root. Measured today: 0 orphans and
-- 0 soft-deleted comments, so this is about the first take-down, not about
-- cleaning up after one.
--
-- SECURITY INVOKER, EXPLICITLY — unlike 115
--
-- 115 had to be SECURITY DEFINER because it reads `positions`, whose policy is
-- "users can view own positions"; it exists to publish an audited, minimal
-- projection past that policy. This function reads nothing the caller could
-- not already read. It is server-side assembly, not a privilege, and making it
-- DEFINER would hand it the power to serve soft-deleted comments to anyone.
-- It is declared INVOKER so every policy on `comments` and `profiles` applies
-- to the caller exactly as it does to the query it replaces.
--
-- KEYSET, NOT OFFSET — WHERE WE IMPROVE ON POLYMARKET
--
-- Polymarket pages with `offset`. Under insertion that is wrong: a comment
-- posted between page 1 and page 2 shifts every later row down one, so page 2
-- repeats the row page 1 ended on. A live thread is the case where it is most
-- likely and least noticeable.
--
-- The cursor is therefore (created_at, id), not created_at alone, and that is
-- a measurement, not caution: 216 live comments carry only 125 distinct
-- timestamps, with up to THREE comments in one market sharing a timestamp to
-- the microsecond. A cursor on created_at alone would skip or duplicate rows
-- at any page boundary landing inside a tie group, which at 3-way ties and a
-- 20-row page is close to certain rather than theoretical.

-- Step 0 — drop every prior signature so a re-run cannot leave two overloads
-- resolvable by the same call (the idempotence trap that made 113 produce a
-- different answer on its second run).
DROP FUNCTION IF EXISTS public.market_comments_page(UUID, INT, TIMESTAMPTZ, UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.market_comments_page(UUID, INT, TIMESTAMPTZ, BOOLEAN);

CREATE FUNCTION public.market_comments_page(
  p_market_id UUID,
  p_limit     INT         DEFAULT 20,
  p_cursor_at TIMESTAMPTZ DEFAULT NULL,
  p_cursor_id UUID        DEFAULT NULL,
  p_newest    BOOLEAN     DEFAULT TRUE
)
RETURNS TABLE (
  id                  UUID,
  market_id           UUID,
  user_id             UUID,
  parent_id           UUID,
  content             TEXT,
  like_count          INT,
  created_at          TIMESTAMPTZ,
  is_reply            BOOLEAN,
  author_display_name TEXT,
  author_username     TEXT,
  author_avatar_url   TEXT,
  -- Roots drive "Show N more"; total drives the "Comments (N)" tab label,
  -- which counts replies too — the label would otherwise undercount every
  -- thread by the number of replies in it.
  total_roots         BIGINT,
  total_comments      BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH visible AS (
    -- Every comment on this market the CALLER may see. RLS has already been
    -- applied here; the explicit is_deleted keeps the intent readable and
    -- keeps an admin (who may see deleted rows) from being served them in a
    -- public thread.
    SELECT c.id, c.market_id, c.user_id, c.parent_id, c.content,
           COALESCE(c.like_count, 0) AS like_count, c.created_at
    FROM comments c
    WHERE c.market_id = p_market_id
      AND c.is_deleted = FALSE
  ),
  roots AS (
    -- A root is a comment with no VISIBLE parent: either it never had one, or
    -- its parent was taken down and the reply must bubble up rather than
    -- disappear. See the header.
    SELECT v.*
    FROM visible v
    WHERE NOT EXISTS (SELECT 1 FROM visible p WHERE p.id = v.parent_id)
  ),
  counted AS (
    SELECT (SELECT COUNT(*) FROM roots)::BIGINT   AS n_roots,
           (SELECT COUNT(*) FROM visible)::BIGINT AS n_all
  ),
  page AS (
    SELECT r.*
    FROM roots r
    WHERE p_cursor_at IS NULL
       OR p_cursor_id IS NULL
       OR (p_newest     AND (r.created_at, r.id) < (p_cursor_at, p_cursor_id))
       OR (NOT p_newest AND (r.created_at, r.id) > (p_cursor_at, p_cursor_id))
    -- Two sort keys per direction. The pair belonging to the other direction
    -- evaluates to NULL for every row, so it ties and has no effect.
    ORDER BY
      CASE WHEN p_newest     THEN r.created_at END DESC,
      CASE WHEN p_newest     THEN r.id         END DESC,
      CASE WHEN NOT p_newest THEN r.created_at END ASC,
      CASE WHEN NOT p_newest THEN r.id         END ASC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
  ),
  thread_rows AS (
    SELECT p.*, FALSE AS is_reply FROM page p
    UNION ALL
    -- The replies of exactly this page's roots, so a thread always arrives
    -- whole. Replies are never themselves paged: measured, the deepest thread
    -- on the platform has 4 of them.
    SELECT v.*, TRUE AS is_reply
    FROM visible v
    WHERE v.parent_id IN (SELECT page.id FROM page)
  )
  SELECT r.id, r.market_id, r.user_id, r.parent_id, r.content, r.like_count,
         r.created_at, r.is_reply,
         pr.display_name, pr.username, pr.avatar_url,
         (SELECT n_roots FROM counted),
         (SELECT n_all FROM counted)
  FROM thread_rows r
  LEFT JOIN profiles pr ON pr.id = r.user_id
  ORDER BY r.created_at ASC, r.id ASC;
$$;

COMMENT ON FUNCTION public.market_comments_page(UUID, INT, TIMESTAMPTZ, UUID, BOOLEAN) IS
  'One keyset page of a market comment thread: p_limit roots plus all their replies, with author fields and the total root count. SECURITY INVOKER — RLS applies to the caller, and a reply whose parent was taken down bubbles up because the parent is invisible to that caller. Matrix C11.';

GRANT EXECUTE ON FUNCTION public.market_comments_page(UUID, INT, TIMESTAMPTZ, UUID, BOOLEAN) TO anon, authenticated;

-- The root page is now the hot path, and `WHERE parent_id IS NULL` cannot use
-- idx_comments_market (market_id, created_at DESC) to skip replies. Irrelevant
-- at 216 rows; this is the index the 24,000-comment case needs, and it costs
-- nothing to put in now.
CREATE INDEX IF NOT EXISTS idx_comments_market_roots
  ON public.comments (market_id, created_at DESC, id DESC)
  WHERE parent_id IS NULL AND is_deleted = FALSE;

-- Replies are fetched by parent, which had no index at all.
CREATE INDEX IF NOT EXISTS idx_comments_parent
  ON public.comments (parent_id)
  WHERE parent_id IS NOT NULL AND is_deleted = FALSE;
