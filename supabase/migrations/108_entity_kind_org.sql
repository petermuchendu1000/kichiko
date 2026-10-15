-- 108_entity_kind_org.sql
-- ------------------------------------------------------------
-- Add 'org' to the entity-kind resolver set.
--
-- 022_option_entity_media.sql documents entity_kind as a resolver hint
-- ("person → Wikipedia, company → Brandfetch, …") and fixed the set at
-- person|company|crypto|place|team|other.
--
-- The cover backfill (scripts/backfill_market_covers.py) resolves a fourth
-- class that none of those name: institutions whose official mark comes from
-- Wikipedia-or-favicon rather than a brand API — IEBC, CAF, FKF, CBK, KNBS,
-- KRA, Parliament, the National Treasury, SHA, NSE, the Met Department,
-- Boma Yangu, DCP. Calling IEBC a 'company' is wrong and 'other' discards the
-- routing information the column exists to carry.
--
-- Additive and reversible: widening a CHECK rejects no existing row, and no
-- application code branches on this value (it is provenance/resolver metadata
-- read only by the backfill job).
--
-- Both tables are widened together so the option-level and market-level sets
-- stay identical, as 022 established.

ALTER TABLE public.market_options
  DROP CONSTRAINT IF EXISTS market_options_entity_kind_chk;

ALTER TABLE public.market_options
  ADD CONSTRAINT market_options_entity_kind_chk
  CHECK (entity_kind IS NULL OR entity_kind IN
    ('person','company','org','crypto','place','team','other'));

ALTER TABLE public.markets
  DROP CONSTRAINT IF EXISTS markets_cover_entity_kind_chk;

ALTER TABLE public.markets
  ADD CONSTRAINT markets_cover_entity_kind_chk
  CHECK (cover_entity_kind IS NULL OR cover_entity_kind IN
    ('person','company','org','crypto','place','team','other'));

COMMENT ON COLUMN public.market_options.entity_kind IS 'Resolver hint: person|company|org|crypto|place|team|other.';
COMMENT ON COLUMN public.markets.cover_entity_kind   IS 'Resolver hint: person|company|org|crypto|place|team|other.';
