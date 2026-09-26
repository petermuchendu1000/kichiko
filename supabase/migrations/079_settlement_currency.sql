-- 079_settlement_currency.sql
-- ---------------------------------------------------------------------------
-- Settlement currency = the currency of the user's country (owner decision;
-- the country is detected in the browser). Design and evidence:
-- docs/research/engine-2026-09/15-CURRENCY-FLOW.md §5.
--
-- BEFORE (bug register C1, P5):
--   * signup defaulted every user to KE/KES when no country was sent, and
--     created KES, UGX, TZS and RWF wallets plus the chosen one, never checking
--     that the currency matched the country (003);
--   * users could change country_code and preferred_currency at any time
--     through PATCH /api/profile (060 grant), and every money route trusted
--     the request's currency: buy in one currency, sell or settle in another,
--     i.e. a free FX conversion at a platform rate.
--
-- AFTER (this migration; the API routes follow in the same change):
--   * supported_countries: the 7 countries, their currency and dial code.
--   * profiles.settlement_currency is DERIVED from country_code by a trigger
--     (NULL for an unsupported country: never a silent KES default);
--     preferred_currency mirrors it for existing readers. Plus country_source,
--     country_signals (detection evidence), country_changed_at and
--     settlement_locked_at.
--   * users can no longer UPDATE country_code / preferred_currency directly
--     (060 grant re-issued without them). They change country only through
--     set_my_country(), allowed while the currency is unlocked, the user has
--     no money activity, and at most once per 24 h.
--   * the first order, deposit or withdrawal locks the settlement currency
--     (AFTER INSERT triggers). After that only a server session with
--     SET LOCAL app.settlement_country_override = 'on' can change it.
--   * handle_new_user: country must be supported, the currency is derived
--     (metadata currency ignored), and ONLY the settlement wallet is created.
--   * user_settlement(user): the single server-side answer (country, currency,
--     wallet, lock) every money route uses.
-- Existing users: settlement_currency backfilled from their country
-- (country_source 'legacy'), unlocked; wallets are untouched (all current
-- data is seed data; classification of multi-currency accounts is a later
-- step, report §5.5).
-- Error codes: P0170 locked, P0171 unsupported country, P0172 money activity,
-- P0173 rate limited, P0174 not signed in.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS public.supported_countries (
  code      char(2) PRIMARY KEY CHECK (code = upper(code)),
  name      text NOT NULL,
  currency  currency_code NOT NULL UNIQUE,
  dial_code text NOT NULL,
  enabled   boolean NOT NULL DEFAULT true
);
INSERT INTO public.supported_countries (code, name, currency, dial_code) VALUES
  ('KE', 'Kenya',    'KES', '254'),
  ('UG', 'Uganda',   'UGX', '256'),
  ('TZ', 'Tanzania', 'TZS', '255'),
  ('RW', 'Rwanda',   'RWF', '250'),
  ('ZM', 'Zambia',   'ZMW', '260'),
  ('ET', 'Ethiopia', 'ETB', '251'),
  ('BI', 'Burundi',  'BIF', '257')
ON CONFLICT (code) DO NOTHING;
-- public reference data: readable, not writable, by clients
ALTER TABLE public.supported_countries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supported countries are public" ON public.supported_countries;
CREATE POLICY "supported countries are public" ON public.supported_countries FOR SELECT USING (true);
REVOKE ALL ON public.supported_countries FROM anon, authenticated, PUBLIC;
GRANT SELECT ON public.supported_countries TO anon, authenticated;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS settlement_currency  currency_code,
  ADD COLUMN IF NOT EXISTS country_source       text CHECK (country_source IS NULL OR country_source IN ('browser','manual','admin','legacy')),
  ADD COLUMN IF NOT EXISTS country_signals      jsonb,
  ADD COLUMN IF NOT EXISTS country_changed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS settlement_locked_at timestamptz;
ALTER TABLE public.profiles ALTER COLUMN country_code DROP DEFAULT;

-- derive settlement_currency from country_code; mirror into preferred_currency;
-- refuse a currency change once locked (unless an explicit server override)
CREATE OR REPLACE FUNCTION public.profiles_settlement_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.country_code := NULLIF(upper(trim(NEW.country_code)), '');
  SELECT sc.currency INTO NEW.settlement_currency
    FROM public.supported_countries sc WHERE sc.code = NEW.country_code AND sc.enabled;
  IF NOT FOUND THEN NEW.settlement_currency := NULL; END IF;
  IF NEW.settlement_currency IS NOT NULL THEN
    NEW.preferred_currency := NEW.settlement_currency;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.settlement_locked_at IS NOT NULL
     AND NEW.settlement_currency IS DISTINCT FROM OLD.settlement_currency
     AND COALESCE(current_setting('app.settlement_country_override', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Settlement currency is locked after the first deposit, withdrawal or order'
      USING ERRCODE = 'P0170';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_profiles_settlement_sync ON public.profiles;
CREATE TRIGGER trg_profiles_settlement_sync
  BEFORE INSERT OR UPDATE OF country_code, settlement_currency, preferred_currency ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_settlement_sync();

-- backfill existing users (fires the trigger: derives + mirrors)
UPDATE public.profiles SET country_code = country_code,
       country_source = COALESCE(country_source, 'legacy')
 WHERE country_code IS NOT NULL;

-- users may no longer edit country_code / preferred_currency directly (060 list minus those two)
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (
  display_name, username, bio, phone_number, avatar_url,
  email_notifications, sms_notifications, push_notifications, preferred_locale
) ON public.profiles TO authenticated;

-- lock on the first money event
CREATE OR REPLACE FUNCTION public.lock_settlement_currency()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.profiles SET settlement_locked_at = now()
   WHERE id = NEW.user_id AND settlement_locked_at IS NULL;
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.lock_settlement_currency() FROM anon, authenticated, PUBLIC;

DROP TRIGGER IF EXISTS trg_lock_settlement_on_order ON public.clob_orders;
CREATE TRIGGER trg_lock_settlement_on_order AFTER INSERT ON public.clob_orders
  FOR EACH ROW EXECUTE FUNCTION public.lock_settlement_currency();
DROP TRIGGER IF EXISTS trg_lock_settlement_on_deposit ON public.deposits;
CREATE TRIGGER trg_lock_settlement_on_deposit AFTER INSERT ON public.deposits
  FOR EACH ROW EXECUTE FUNCTION public.lock_settlement_currency();
DROP TRIGGER IF EXISTS trg_lock_settlement_on_withdrawal ON public.withdrawals;
CREATE TRIGGER trg_lock_settlement_on_withdrawal AFTER INSERT ON public.withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.lock_settlement_currency();

-- the user's own country change (browser detection or manual pick)
CREATE OR REPLACE FUNCTION public.set_my_country(p_country text, p_signals jsonb DEFAULT '{}'::jsonb, p_source text DEFAULT 'browser')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_code    char(2) := upper(trim(p_country));
  v_cur     currency_code;
  v_prof    public.profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = 'P0174';
  END IF;
  SELECT currency INTO v_cur FROM public.supported_countries WHERE code = v_code AND enabled;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Kichiko is not available in country %', p_country USING ERRCODE = 'P0171';
  END IF;
  SELECT * INTO v_prof FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF v_prof.settlement_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Settlement currency is locked after the first deposit, withdrawal or order' USING ERRCODE = 'P0170';
  END IF;
  IF v_prof.country_code = v_code THEN
    RETURN jsonb_build_object('country', v_code, 'currency', v_cur, 'changed', false);
  END IF;
  IF v_prof.country_changed_at > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'Country can be changed once per 24 hours' USING ERRCODE = 'P0173';
  END IF;
  IF EXISTS (SELECT 1 FROM public.wallets WHERE user_id = v_uid AND (available_balance <> 0 OR reserved_balance <> 0))
     OR EXISTS (SELECT 1 FROM public.clob_orders WHERE user_id = v_uid)
     OR EXISTS (SELECT 1 FROM public.positions WHERE user_id = v_uid AND shares <> 0)
     OR EXISTS (SELECT 1 FROM public.deposits WHERE user_id = v_uid)
     OR EXISTS (SELECT 1 FROM public.withdrawals WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Country cannot change once the account has money activity' USING ERRCODE = 'P0172';
  END IF;

  UPDATE public.profiles
     SET country_code = v_code,
         country_source = CASE WHEN p_source IN ('browser','manual') THEN p_source ELSE 'browser' END,
         country_signals = COALESCE(p_signals, '{}'::jsonb),
         country_changed_at = now()
   WHERE id = v_uid;
  INSERT INTO public.wallets (user_id, currency) VALUES (v_uid, v_cur) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('country', v_code, 'currency', v_cur, 'changed', true);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.set_my_country(text, jsonb, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_country(text, jsonb, text) TO authenticated;

-- the single server-side source of truth for money routes
CREATE OR REPLACE FUNCTION public.user_settlement(p_user uuid)
 RETURNS TABLE (country char(2), currency currency_code, wallet_id uuid, locked boolean)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user THEN
    RAISE EXCEPTION 'Not authorized to act on behalf of another user' USING ERRCODE = 'P0121';
  END IF;
  RETURN QUERY
    SELECT p.country_code, p.settlement_currency, w.id, p.settlement_locked_at IS NOT NULL
      FROM public.profiles p
      LEFT JOIN public.wallets w ON w.user_id = p.id AND w.currency = p.settlement_currency
     WHERE p.id = p_user;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.user_settlement(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_settlement(uuid) TO authenticated, service_role;

-- signup: supported country only, derived currency, ONE wallet
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $function$
DECLARE
  meta            JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_display_name  TEXT;
  v_country       TEXT;
  v_currency      currency_code;
  v_source        TEXT;
  v_signals       JSONB;
  v_referral_code TEXT;
  v_referrer_id   UUID;
BEGIN
  v_display_name := COALESCE(NULLIF(meta->>'display_name', ''), NULLIF(meta->>'full_name', ''), NEW.email);

  -- [079] a supported country or nothing (never a silent KE default)
  v_country := upper(NULLIF(trim(meta->>'country_code'), ''));
  SELECT currency INTO v_currency FROM public.supported_countries WHERE code = v_country AND enabled;
  IF NOT FOUND THEN v_country := NULL; v_currency := NULL; END IF;
  v_source := CASE WHEN meta->>'country_source' IN ('browser','manual') THEN meta->>'country_source'
                   WHEN v_country IS NOT NULL THEN 'manual' END;
  v_signals := CASE WHEN jsonb_typeof(meta->'country_signals') = 'object' THEN meta->'country_signals' END;

  v_referral_code := COALESCE(NULLIF(meta->>'referral_code_used', ''), NULLIF(meta->>'referral_code', ''));
  IF v_referral_code IS NOT NULL THEN
    SELECT id INTO v_referrer_id FROM public.profiles WHERE referral_code = v_referral_code;
  END IF;

  -- settlement_currency / preferred_currency are derived by trg_profiles_settlement_sync
  INSERT INTO public.profiles (id, display_name, avatar_url, country_code, country_source, country_signals,
                               country_changed_at, referred_by)
  VALUES (NEW.id, v_display_name, meta->>'avatar_url', v_country, v_source, v_signals,
          CASE WHEN v_country IS NOT NULL THEN now() END, v_referrer_id);

  IF v_currency IS NOT NULL THEN
    INSERT INTO public.wallets (user_id, currency) VALUES (NEW.id, v_currency) ON CONFLICT DO NOTHING;
  END IF;

  IF v_referrer_id IS NOT NULL THEN
    UPDATE public.profiles SET referral_count = referral_count + 1 WHERE id = v_referrer_id;
    INSERT INTO public.referrals (referrer_id, referred_id, referral_code)
    VALUES (v_referrer_id, NEW.id, v_referral_code);
  END IF;

  RETURN NEW;
END;
$function$;

COMMIT;
