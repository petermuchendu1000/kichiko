-- 097_market_card_options.sql — top options per market, ranked in the
-- database (audit 6.43).
--
-- BUG: getCardOptions (market cards, search) and getLeadingOptions (the
-- "related markets" rail) selected EVERY option of every market on the page,
-- unordered, in one PostgREST request. A response holds at most max_rows
-- (1,000, supabase/config.toml) rows, so once a page's markets had more than
-- 1,000 options in total the tail was cut at an arbitrary point: cards showed
-- the wrong front-runners and a wrong "+N more", with no error.
--
-- FIX: rank per market here and return only the top p_per_market rows plus
-- each market's option count. SECURITY INVOKER: market_options RLS applies,
-- exactly as for the table read it replaces. Bounded: at most 100 markets x 5
-- options (500 rows), under max_rows. The ranking value and order are the
-- app's (yes_price, else price, else 0; highest first), with display_order
-- and id breaking ties deterministically.
BEGIN;

CREATE OR REPLACE FUNCTION public.market_card_options(p_market_ids uuid[], p_per_market integer DEFAULT 2)
RETURNS TABLE (market_id uuid, id uuid, label text, price numeric, image_url text, option_count integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT t.market_id, t.id, t.label, t.price, t.image_url, t.option_count
    FROM (
      SELECT o.market_id, o.id, o.label,
             COALESCE(o.yes_price, o.price, 0)::numeric AS price,
             o.image_url,
             (count(*) OVER (PARTITION BY o.market_id))::integer AS option_count,
             row_number() OVER (PARTITION BY o.market_id
                                ORDER BY COALESCE(o.yes_price, o.price, 0) DESC, o.display_order, o.id) AS rn
        FROM public.market_options o
       WHERE o.market_id = ANY (p_market_ids[1:100])
    ) t
   WHERE t.rn <= LEAST(GREATEST(COALESCE(p_per_market, 2), 1), 5)
   ORDER BY t.market_id, t.rn;
$$;

REVOKE ALL ON FUNCTION public.market_card_options(uuid[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.market_card_options(uuid[], integer) TO anon, authenticated, service_role;

COMMIT;
