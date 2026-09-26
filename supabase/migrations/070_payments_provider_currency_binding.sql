-- 070_payments_provider_currency_binding.sql
-- ---------------------------------------------------------------------------
-- Defense in depth for the provider/currency binding enforced in the API
-- (apps/web/lib/payments/provider-currency.ts).
--
-- PROBLEM (CONFIRMED in code)
--   The deposit and withdrawal routes accepted any currency with any provider,
--   while the integrations settle in a currency fixed by the provider:
--     * M-Pesa STK push charges `Amount` in shillings (lib/payments/mpesa.ts:170-177)
--       and credit_deposit credits deposit.amount to the wallet of the currency
--       the user picked (052:53-55): "deposit USD 100 via M-Pesa" charged
--       KSh 100 (~$0.78) and credited $100.
--     * M-Pesa B2C pays `Amount` in shillings (lib/payments/index.ts:240): a
--       UGX 100,000 withdrawal paid out KSh 100,000 (~28x its value).
--   Combined with secondary trading between two accounts, the inflated balance
--   converts into real, withdrawable shillings.
--
-- FIX (this migration): CHECK constraints so no code path, present or future,
-- can persist a deposit or withdrawal in a currency its integration does not
-- settle in. Rules mirror what the integration code hardcodes:
--   deposits    mpesa -> KES; airtel_money -> KES/TZS/UGX/RWF/ZMW (country
--               currency; the country itself is checked in the API);
--               mtn_momo -> UGX/RWF; pesapal -> KES/UGX/TZS/RWF/ZMW
--   withdrawals mpesa -> KES; airtel_money -> KES (X-Country: KE hardcoded);
--               mtn_momo -> UGX (production target mtnuganda); any other
--               provider has no payout implementation and is rejected.
-- Added NOT VALID then VALIDATEd: if any existing row violated a rule the
-- migration aborts rather than silently grandfathering it. (Production
-- snapshot 2026-09-26: 1,468 deposits and 9 withdrawals, all mpesa/KES.)
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE public.deposits
  ADD CONSTRAINT ck_deposits_provider_currency CHECK (
    (provider <> 'mpesa'        OR currency = 'KES') AND
    (provider <> 'airtel_money' OR currency IN ('KES','TZS','UGX','RWF','ZMW')) AND
    (provider <> 'mtn_momo'     OR currency IN ('UGX','RWF')) AND
    (provider <> 'pesapal'      OR currency IN ('KES','UGX','TZS','RWF','ZMW'))
  ) NOT VALID;
ALTER TABLE public.deposits VALIDATE CONSTRAINT ck_deposits_provider_currency;

ALTER TABLE public.withdrawals
  ADD CONSTRAINT ck_withdrawals_provider_currency CHECK (
    (provider = 'mpesa'        AND currency = 'KES') OR
    (provider = 'airtel_money' AND currency = 'KES') OR
    (provider = 'mtn_momo'     AND currency = 'UGX')
  ) NOT VALID;
ALTER TABLE public.withdrawals VALIDATE CONSTRAINT ck_withdrawals_provider_currency;

COMMIT;
