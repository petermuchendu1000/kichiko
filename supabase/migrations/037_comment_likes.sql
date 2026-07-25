-- =====================================================================
-- Migration 037: Comment likes (threading-ready social layer)
--
-- Adds the `comment_likes` junction table that backs the "like" affordance on
-- market comments and replies. The `comments` table already carries `parent_id`
-- (threading) and a denormalised `like_count`; what was missing was a way to
-- record WHO liked a comment so the UI can (a) toggle a user's own like without
-- double-counting and (b) render the "liked by me" state on load. This migration
-- supplies that, plus a trigger that keeps `comments.like_count` in sync.
--
-- Scope (per product decision): replies + likes + share only. NO notifications
-- are emitted for likes or replies, so this migration deliberately does not
-- touch the `notification_type` enum or the notifications pipeline.
--
-- Security model (matches the repo-wide convention from migration 032):
--   * RLS enabled; SELECT is public (like counts/among-whom is public data).
--   * INSERT is self-only  (auth.uid() = user_id)  -> you may only like as you.
--   * DELETE is self-only  (auth.uid() = user_id)  -> you may only unlike your own.
--   * No UPDATE policy: a like is immutable; you either hold it or you don't.
-- Blanket anon/authenticated grants come from the schema default privileges
-- established in 032; they are restated here idempotently so this migration is
-- self-contained and safe to run against a fresh database.
--
-- Count integrity: `sync_comment_like_count` is SECURITY DEFINER with a FIXED
-- `search_path = public`, so it can bump `comments.like_count` regardless of the
-- liker owning the comment, without opening a search-path injection surface. It
-- intentionally does NOT touch `comments.updated_at` (a like must not make a
-- comment look "edited"). GREATEST(0, ...) guards the count from going negative.
--
-- Cascades: comment_id -> comments(id) ON DELETE CASCADE and
--           user_id    -> profiles(id) ON DELETE CASCADE
-- so deleting a comment or a profile cleans up its likes automatically.
-- (The comments.parent_id self-FK is NO ACTION by design; the app soft-deletes
-- comments via is_deleted, and the UI renders a "[comment removed]" placeholder
-- for soft-deleted parents that still have replies, so threads never vanish.)
--
-- Additive & reversible. Idempotent: IF NOT EXISTS / CREATE OR REPLACE /
-- DROP ... IF EXISTS throughout, so re-running is a no-op. This mirrors the
-- objects already present in the live database (drift-repair: the objects were
-- applied ad hoc in an earlier session; this file restores version-control
-- parity so `supabase db push` reproduces them from source).
--
-- Rollback (expand/contract): remove the comment_likes relation with CASCADE,
-- then remove the sync_comment_like_count function. The comments.like_count
-- column is left intact; it simply stops being maintained. See docs/DEPLOYMENT.md
-- for the destructive-change opt-in convention that gates such a rollback.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Table.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.comment_likes (
  comment_id  UUID NOT NULL REFERENCES public.comments (id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One like per (comment, user): the PK is the natural uniqueness guard, so a
  -- double-like is rejected at the DB layer (the client treats the conflict as
  -- "already liked" and reconciles optimistically).
  PRIMARY KEY (comment_id, user_id)
);

-- ---------------------------------------------------------------------
-- 2. Indexes.
--    PK already indexes (comment_id, user_id). We add single-column indexes so
--    both access patterns are fast: "who liked this comment" (comment_id) and
--    "which comments did this user like" (user_id, e.g. hydrating liked-by-me).
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS comment_likes_comment_idx ON public.comment_likes (comment_id);
CREATE INDEX IF NOT EXISTS comment_likes_user_idx    ON public.comment_likes (user_id);

-- ---------------------------------------------------------------------
-- 3. Row-Level Security.
-- ---------------------------------------------------------------------
ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Comment likes are publicly viewable" ON public.comment_likes;
CREATE POLICY "Comment likes are publicly viewable"
  ON public.comment_likes
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Users can like as themselves" ON public.comment_likes;
CREATE POLICY "Users can like as themselves"
  ON public.comment_likes
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can remove their own like" ON public.comment_likes;
CREATE POLICY "Users can remove their own like"
  ON public.comment_likes
  FOR DELETE
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 4. Count-sync trigger. Keeps comments.like_count == count(comment_likes).
--    SECURITY DEFINER so it can update a comment the liker doesn't own; FIXED
--    search_path so there's no injection surface. updated_at is left untouched.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_comment_like_count()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    UPDATE public.comments
       SET like_count = COALESCE(like_count, 0) + 1
     WHERE id = NEW.comment_id;
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.comments
       SET like_count = GREATEST(0, COALESCE(like_count, 0) - 1)
     WHERE id = OLD.comment_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_comment_like_count ON public.comment_likes;
CREATE TRIGGER trg_comment_like_count
  AFTER INSERT OR DELETE ON public.comment_likes
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_comment_like_count();

-- ---------------------------------------------------------------------
-- 5. Grants (restate the 032 convention so this migration is self-contained).
--    RLS gates the actual rows; grants just open the door for the roles.
-- ---------------------------------------------------------------------
GRANT SELECT ON public.comment_likes TO anon, authenticated;
GRANT INSERT, DELETE ON public.comment_likes TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_comment_like_count() TO authenticated, service_role;
