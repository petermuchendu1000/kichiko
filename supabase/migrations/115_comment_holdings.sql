-- 115_comment_holdings.sql
-- ---------------------------------------------------------------------------
-- Which side a commenter is on — and deliberately NOT how much.
--
-- WHY (matrix C10, measured 2026-10-16)
--
-- Polymarket wears every commenter's position beside their name:
-- `76.7K Flávio Bolsonaro`. It is the cheapest credibility signal a market
-- has. A reader deciding how much weight to give "Lula is finished" is
-- entitled to know the author is long Bolsonaro, and on our board they could
-- not find out: comments carried a name, a time and a body.
--
-- The signal is worth having. Measured on ke-2027-president, 23 of 25
-- commenters hold a position in the market they are arguing about.
--
-- WHY SIDE AND NOT SIZE — WHERE WE DIVERGE FROM POLYMARKET ON PURPOSE
--
-- Polymarket's commenters are pseudonymous wallets. Ours are named, KYC'd
-- Kenyans: the same badge here reads "Tabitha Chebet holds 5,889 shares of
-- Gachagua". That is personal financial data about an identified person under
-- the Data Protection Act 2019, and it is not what the reader needs.
--
-- The disclosure that does the work is WHICH SIDE, not how much. "Backs
-- Gachagua" tells you exactly how to discount the argument; the amount adds
-- almost nothing to that judgement and a great deal to the commenter's
-- exposure. This is the convention financial journalism settled on — "the
-- author holds a position in X" — and it is the better design, not a watered
-- down one.
--
-- The 29 existing top-holder rows are not a precedent for size here. That RPC
-- publishes the top TEN of a market, a standing public leaderboard. Measured:
-- ZERO of this market's 25 commenters appear in it, so a size badge would be
-- a first publication of 23 people's holdings, attached to them because they
-- spoke rather than because they are large.
--
-- WHY AN RPC AND NOT A RELAXED POLICY
--
-- `positions` RLS is "Users can view own positions". It stays that way. Every
-- public view of a holding on this platform goes through an audited
-- SECURITY DEFINER function that returns a named, minimal projection (026,
-- 028), and this is the third. Widening the policy would expose every column
-- of every row to anyone who learned to ask.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.market_comment_holdings(p_market_id UUID)
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
    -- Only people who have spoken publicly in this market. A position alone
    -- is nobody's business; a position held by someone arguing the market is
    -- a disclosure the argument needs.
    AND EXISTS (
      SELECT 1 FROM public.comments c
       WHERE c.market_id = p_market_id
         AND c.user_id = p.user_id
         AND c.is_deleted = FALSE
    )
  ORDER BY p.user_id, p.shares DESC;
$$;

GRANT EXECUTE ON FUNCTION public.market_comment_holdings(UUID) TO anon, authenticated;

COMMENT ON FUNCTION public.market_comment_holdings(UUID)
  IS 'Which side each commenter on a market is on. Returns the outcome and side only — never shares, value or cost — and only for users who have posted a visible comment on that market. See 115 for why size is withheld.';
