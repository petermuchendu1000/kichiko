-- 117_comment_holdings_one_user.sql
-- ---------------------------------------------------------------------------
-- Ask the disclosure RPC about ONE commenter instead of all of them.
--
-- WHY (matrix C11, measured 2026-10-16)
--
-- 116 cut the cost of a new comment from a whole-thread refetch to a single
-- row. What was left was the badge lookup: when someone comments who has no
-- badge yet, every open viewer re-ran `market_comment_holdings(market)` — 23
-- rows, 3,440 B — to learn one person's side.
--
-- Not refetching was not an option. A live comment arriving with no badge
-- beside a thread where everyone else has one does not read as "unknown", it
-- reads as "holds nothing", which is a false statement about a named person.
-- So the answer is to ask a narrower question, not to skip it.
--
--   measured : 3,440 B for 23 rows  ->  ~150 B for 1 row
--
-- Per distinct new commenter, per viewer. On a thread with 300 commenters and
-- 100 viewers that is 103 MB against 4.5 MB.
--
-- THE FILTER MUST NARROW AND NEVER WIDEN
--
-- This function is SECURITY DEFINER over `positions`, whose policy is "users
-- can view own positions". It is allowed to exist only because of the gate in
-- its WHERE clause: it discloses a side ONLY for someone who has posted a
-- visible comment on that market. A position alone is nobody's business.
--
-- Taking a user id therefore cannot be allowed to bypass that gate, or the
-- function stops being a disclosure of commenters and becomes an oracle for
-- any account's position in any market. The EXISTS stays exactly where it is
-- and applies to the filtered row too: asking about someone who has not
-- commented here returns nothing. There is a test for precisely that below,
-- because it is the assertion that matters in this file.
--
-- WHY A NEW MIGRATION AND NOT `CREATE OR REPLACE`
--
-- Adding a defaulted parameter does not replace a function, it overloads it:
-- `(UUID)` and `(UUID, UUID DEFAULT NULL)` would both be candidates for a
-- one-argument call and Postgres would refuse it as ambiguous. The old
-- signature is dropped first. (Same trap as 113's non-idempotent trigger and
-- 116's step 0.)

DROP FUNCTION IF EXISTS public.market_comment_holdings(UUID);
DROP FUNCTION IF EXISTS public.market_comment_holdings(UUID, UUID);

CREATE FUNCTION public.market_comment_holdings(
  p_market_id UUID,
  -- NULL = every commenter on the market, which is what the page load wants.
  p_user_id   UUID DEFAULT NULL
)
RETURNS TABLE (
  user_id      UUID,
  option_id    UUID,
  option_label TEXT,
  side         TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- One badge per commenter: the position they have most of.
  --
  -- `shares` orders the choice and is never returned. Someone holding three
  -- outcomes is shown the one they are most committed to, which is the
  -- disclosure a reader would want; listing all three would turn a badge into
  -- a portfolio statement.
  SELECT DISTINCT ON (p.user_id)
         p.user_id,
         p.market_option_id          AS option_id,
         mo.label                    AS option_label,
         p.side::text                AS side
  FROM public.positions p
  LEFT JOIN public.market_options mo ON mo.id = p.market_option_id
  WHERE p.market_id = p_market_id
    AND p.is_active = TRUE
    AND p.shares > 0
    -- Narrowing only. NULL asks about everyone, as before.
    AND (p_user_id IS NULL OR p.user_id = p_user_id)
    -- Only people who have spoken publicly in this market. A position alone
    -- is nobody's business; a position held by someone arguing the market is
    -- a disclosure the argument needs.
    --
    -- THIS GATE IS WHY THE FUNCTION MAY BE SECURITY DEFINER. It applies to a
    -- single-user request exactly as it does to the full list: ask about
    -- somebody who has not commented here and the answer is nothing.
    AND EXISTS (
      SELECT 1 FROM public.comments c
       WHERE c.market_id = p_market_id
         AND c.user_id = p.user_id
         AND c.is_deleted = FALSE
    )
  ORDER BY p.user_id, p.shares DESC;
$$;

GRANT EXECUTE ON FUNCTION public.market_comment_holdings(UUID, UUID) TO anon, authenticated;

COMMENT ON FUNCTION public.market_comment_holdings(UUID, UUID)
  IS 'Which side each commenter on a market is on, or just one of them when p_user_id is given. Returns the outcome and side only — never shares, value or cost — and only for users who have posted a visible comment on that market: p_user_id narrows that set and can never widen it. See 115 for why size is withheld and 117 for why it takes a user.';
