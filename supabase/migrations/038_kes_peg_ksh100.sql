-- 038_kes_peg_ksh100.sql
-- Pilot settlement notation: one share = KSh 100.
--
-- The CLOB engine settles each winning share at 1 internal unit of account
-- (historically labelled "USD") and prices in cents (0-100). By pegging the
-- Kenyan Shilling so 1 internal unit = KSh 100 (rate KES->USD = 0.01), every
-- share pays exactly KSh 100 and the 0-100 price reads as BOTH the probability
-- (%) and the shilling cost per share (a Yes at 65% costs KSh 65, pays KSh 100).
--
-- This is a display/settlement peg for the Kenya pilot, not a market FX rate.
-- Reversible: restore a floating KES->USD rate to un-peg the unit of account.
-- Keep in step with FALLBACK_USD_RATES.KES in apps/web/lib/currency.ts.

update public.exchange_rates
  set rate = 0.01, source = 'pilot-peg-ksh100', fetched_at = now()
  where from_currency = 'KES' and to_currency = 'USD';

insert into public.exchange_rates (from_currency, to_currency, rate, source)
  select 'KES', 'USD', 0.01, 'pilot-peg-ksh100'
  where not exists (
    select 1 from public.exchange_rates
    where from_currency = 'KES' and to_currency = 'USD'
  );
