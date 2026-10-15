-- 109_play_breaks.sql
-- ------------------------------------------------------------
-- Self-service breaks and self-exclusion.
--
-- L.N. 112 Reg. 84 requires a licensee to offer self-exclusion, and
-- Reg. 84(2)(d) with 67(3) require it to be immediate and no harder to reach
-- than the things that take money. Ruling I3 of
-- docs/research/ui-2026-09/40-ELEMENT-MATRIX.md sets the bar at two taps.
--
-- What existed before this migration: a sentence on /legal/responsible-play
-- saying "Contact us via the Help page and we'll set it up". That is an email,
-- a wait, and a human — not immediate, and not two taps.
--
-- THREE RULES THIS ENCODES
--
--   1. A break stops PLAY, never PAYOUT. Blocking withdrawals during a break
--      would trap someone's money at the exact moment they have asked to
--      stop, which is the opposite of what Reg. 84 is for. Buying is blocked;
--      selling and withdrawing stay open so a position can be exited.
--
--   2. A break cannot be shortened or deleted. A cooling-off that can be
--      cancelled in the moment of wanting to play is not a cooling-off. RLS
--      grants INSERT and SELECT to the owner and nothing else; only an
--      elevated role can alter a row, for genuine support cases.
--
--   3. Indefinite is a real option. `ends_at NULL` means self-exclusion with
--      no end date, which is the form the regulation names.

CREATE TABLE IF NOT EXISTS public.play_breaks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'break' is a timed cooling-off; 'self_exclusion' is open-ended.
  kind        TEXT NOT NULL CHECK (kind IN ('break', 'self_exclusion')),
  starts_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- NULL = no end date. A timed break must end after it starts.
  ends_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT play_breaks_window_chk CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT play_breaks_kind_chk   CHECK (
    (kind = 'self_exclusion' AND ends_at IS NULL) OR
    (kind = 'break'          AND ends_at IS NOT NULL)
  )
);

-- The hot path is "is this person on a break right now", on every buy.
CREATE INDEX IF NOT EXISTS play_breaks_active_idx
  ON public.play_breaks (user_id, starts_at DESC);

ALTER TABLE public.play_breaks ENABLE ROW LEVEL SECURITY;

-- Owner may start one and read their own. Deliberately no UPDATE and no
-- DELETE policy: see rule 2 above.
DROP POLICY IF EXISTS play_breaks_select_own ON public.play_breaks;
CREATE POLICY play_breaks_select_own ON public.play_breaks
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS play_breaks_insert_own ON public.play_breaks;
CREATE POLICY play_breaks_insert_own ON public.play_breaks
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- The single question every gate asks. SECURITY DEFINER so a caller with no
-- direct table rights can still be checked, STABLE so it can be inlined.
CREATE OR REPLACE FUNCTION public.active_play_break(p_user_id UUID)
RETURNS TABLE (kind TEXT, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.kind, b.starts_at, b.ends_at
  FROM public.play_breaks b
  WHERE b.user_id = p_user_id
    AND b.starts_at <= now()
    AND (b.ends_at IS NULL OR b.ends_at > now())
  -- An open-ended exclusion outranks a timed break that would expire sooner.
  ORDER BY (b.ends_at IS NULL) DESC, b.ends_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.active_play_break(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.active_play_break(UUID) TO authenticated, service_role;

COMMENT ON TABLE public.play_breaks IS
  'Self-service cooling-off and self-exclusion (L.N. 112 Reg. 84). Blocks buying and depositing; never blocks selling or withdrawing. Immutable by the owner once started.';
