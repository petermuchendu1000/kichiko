-- 125_phone_e164.sql
-- ---------------------------------------------------------------------------
-- Store phone numbers in the one shape every downstream system needs.
--
-- THE FAILURE THIS PREVENTS
-- `enqueue_notification_deliveries()` copies `profiles.phone_number` verbatim
-- into `notification_deliveries.destination`, and the worker drops anything
-- that is not `^\+[1-9]\d{7,14}$` as a permanently invalid destination. Not
-- failed and retried: invalid, on the first attempt, forever.
--
-- Meanwhile the column is free text written by three different screens, and
-- the KYC wizard's own placeholder is "+254 7XX XXX XXX" with spaces in it.
-- So a user who typed their number exactly the way we showed them, or the way
-- every Kenyan writes it (0712 345 678), would never receive a deposit
-- confirmation or a payout SMS, and nothing anywhere would look broken.
--
-- WHY HERE AND NOT ONLY IN THE APPLICATION
-- RLS lets a user update their own profile row directly through PostgREST, so
-- a client-side normalisation is advice, not a rule. This trigger is the rule.
-- lib/notifications/phone.ts implements the same mapping for the UI's own
-- feedback and as a safety net over rows written before this existed; the two
-- are pinned to the same cases by the unit tests. Duplicating a short table in
-- the only two places that can enforce it is the cost of having it enforced.

-- ---------------------------------------------------------------------------
-- 1. The rule
-- ---------------------------------------------------------------------------
-- Only the markets Elopis settles in. A number we cannot place is returned
-- UNCHANGED rather than guessed at: an SMS carrying a balance sent to a
-- number we invented is worse than one not sent, and the worker will reject an
-- unusable destination anyway.
CREATE OR REPLACE FUNCTION public.normalize_phone_e164(
  p_input   TEXT,
  p_country CHAR(2) DEFAULT 'KE'
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_raw     TEXT;
  v_digits  TEXT;
  v_plus    BOOLEAN;
  v_dial    TEXT;
  v_lens    INT[];
  v_prefix  TEXT[];
  v_nsn     TEXT;
  r         RECORD;
BEGIN
  IF p_input IS NULL OR length(trim(p_input)) = 0 THEN
    RETURN NULL;
  END IF;

  v_raw := trim(p_input);
  -- 00 is the international prefix everywhere we operate and means the same
  -- thing as a plus; people type it from landline habit.
  v_plus := v_raw ~ '^\+' OR v_raw ~ '^00';
  v_digits := regexp_replace(v_raw, '\D', '', 'g');
  IF v_raw ~ '^00' THEN
    v_digits := substring(v_digits FROM 3);
  END IF;

  IF length(v_digits) = 0 THEN
    RETURN p_input;
  END IF;

  -- Already carries a dialling code we know. Longest code first so 254 is not
  -- shadowed by a shorter one.
  FOR r IN
    SELECT * FROM (VALUES
      ('254', ARRAY[9], ARRAY['7','1']),
      ('255', ARRAY[9], ARRAY['6','7']),
      ('256', ARRAY[9], ARRAY['7']),
      ('250', ARRAY[9], ARRAY['7']),
      ('260', ARRAY[9], ARRAY['9','7']),
      ('251', ARRAY[9], ARRAY['9','7']),
      ('257', ARRAY[8], ARRAY['6','7'])
    ) AS t(dial, lens, prefixes)
    ORDER BY length(t.dial) DESC
  LOOP
    IF v_digits LIKE r.dial || '%' THEN
      v_nsn := substring(v_digits FROM length(r.dial) + 1);
      IF array_length(r.lens, 1) IS NOT NULL
         AND length(v_nsn) = ANY (r.lens)
         AND EXISTS (SELECT 1 FROM unnest(r.prefixes) p WHERE v_nsn LIKE p || '%') THEN
        RETURN '+' || r.dial || v_nsn;
      END IF;
      -- A trunk zero left in after the country code: +254 0712 345 678.
      IF v_nsn ~ '^0' THEN
        v_nsn := substring(v_nsn FROM 2);
        IF length(v_nsn) = ANY (r.lens)
           AND EXISTS (SELECT 1 FROM unnest(r.prefixes) p WHERE v_nsn LIKE p || '%') THEN
          RETURN '+' || r.dial || v_nsn;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- An explicit plus with a code we do not serve. Kept if it is plausible
  -- E.164: Elopis is not the only possible destination, and refusing a
  -- Nigerian number because there is no Nigerian market would be wrong.
  IF v_plus THEN
    IF v_digits ~ '^[1-9][0-9]{7,14}$' THEN
      RETURN '+' || v_digits;
    END IF;
    RETURN p_input;
  END IF;

  -- National form, with or without the trunk zero.
  SELECT t.dial, t.lens, t.prefixes INTO v_dial, v_lens, v_prefix
  FROM (VALUES
    ('KE','254', ARRAY[9], ARRAY['7','1']),
    ('TZ','255', ARRAY[9], ARRAY['6','7']),
    ('UG','256', ARRAY[9], ARRAY['7']),
    ('RW','250', ARRAY[9], ARRAY['7']),
    ('ZM','260', ARRAY[9], ARRAY['9','7']),
    ('ET','251', ARRAY[9], ARRAY['9','7']),
    ('BI','257', ARRAY[8], ARRAY['6','7'])
  ) AS t(cc, dial, lens, prefixes)
  WHERE t.cc = upper(COALESCE(p_country, 'KE'));

  IF v_dial IS NULL THEN
    RETURN p_input;
  END IF;

  v_nsn := CASE WHEN v_digits ~ '^0' THEN substring(v_digits FROM 2) ELSE v_digits END;
  IF length(v_nsn) = ANY (v_lens)
     AND EXISTS (SELECT 1 FROM unnest(v_prefix) p WHERE v_nsn LIKE p || '%') THEN
    RETURN '+' || v_dial || v_nsn;
  END IF;

  RETURN p_input;
END;
$$;

COMMENT ON FUNCTION public.normalize_phone_e164(TEXT, CHAR(2)) IS
  'Best-effort E.164 for the markets Elopis serves. Returns the input unchanged when the number cannot be placed, never a guess.';

-- ---------------------------------------------------------------------------
-- 2. Enforce it on write
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.profiles_normalize_phone()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.phone_number IS NOT NULL THEN
    NEW.phone_number := public.normalize_phone_e164(NEW.phone_number, NEW.country_code);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_normalize_phone ON public.profiles;
CREATE TRIGGER trg_profiles_normalize_phone
  BEFORE INSERT OR UPDATE OF phone_number, country_code ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_normalize_phone();

-- ---------------------------------------------------------------------------
-- 3. Existing rows
-- ---------------------------------------------------------------------------
-- Only rows the function can actually improve are touched, so this does not
-- bump updated_at across the whole table for nothing. `phone_number` is
-- UNIQUE, so a normalisation that would collide with another account is left
-- alone: two people cannot own one number, and a half-applied backfill that
-- aborts on a conflict is worse than one that skips it.
UPDATE public.profiles p
SET phone_number = public.normalize_phone_e164(p.phone_number, p.country_code)
WHERE p.phone_number IS NOT NULL
  AND public.normalize_phone_e164(p.phone_number, p.country_code) IS DISTINCT FROM p.phone_number
  AND NOT EXISTS (
    SELECT 1 FROM public.profiles q
    WHERE q.id <> p.id
      AND q.phone_number = public.normalize_phone_e164(p.phone_number, p.country_code)
  );
