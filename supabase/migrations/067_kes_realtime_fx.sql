-- 067_kes_realtime_fx.sql
-- Un-peg KES: restore a floating, real-time market FX rate.
--
-- Migration 038_kes_peg_ksh100 pinned KES->USD = 0.01 ("1 USD == KSh 100") as a
-- pilot settlement peg. That mispriced every KES<->USD conversion by ~29% vs the
-- real market (~129 KES/USD) and diverged from the live rate the platform
-- already fetches. This migration reverses 038 so KES behaves like every other
-- supported currency: a genuine market quote sourced live by the
-- `update-exchange-rates` cron (lib/integrations/fx.ts) into `exchange_rates`.
--
-- The value below is a fresh bootstrap (matching apps/web/lib/generated/
-- fx-fallback.json); the cron refreshes it on every cycle. There is NO fixed
-- peg anywhere anymore. The share contract is unchanged: one share still settles
-- at 1 internal USD unit ($1, Polymarket-style); the local per-share payout is
-- now derived at the live FX rate (usdToLocal(1, currency, rates)) instead of a
-- hardcoded KSh 100.
--
-- Reversible only by re-pegging (do not).

update public.exchange_rates
  set rate = 0.00775, source = 'exchangerate-api-bootstrap', fetched_at = now()
  where from_currency = 'KES'
    and to_currency = 'USD'
    and source = 'pilot-peg-ksh100';

insert into public.exchange_rates (from_currency, to_currency, rate, source)
  select 'KES', 'USD', 0.00775, 'exchangerate-api-bootstrap'
  where not exists (
    select 1 from public.exchange_rates
    where from_currency = 'KES' and to_currency = 'USD'
  );
