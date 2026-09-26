-- =====================================================================
-- Migration 032: Restore standard anon/authenticated role grants
--
-- Root cause: this database's `public` schema default privileges only cover
-- `postgres` and `service_role`, so the standard Supabase table/sequence/
-- function grants to `anon` and `authenticated` were never established. Every
-- public table already has Row-Level Security enabled (verified: 43/43 real
-- tables; only `schema_migrations` is intentionally without RLS), so the app's
-- security model relies on blanket role grants gated by RLS policies -- but the
-- grants were missing. Result: the anon SSR client hit `42501 permission denied`
-- on ~43 tables and public pages rendered empty ("No live markets yet").
--
-- This restores the conventional Supabase grant model:
--   * anon + authenticated  : SELECT (RLS gates which rows are visible)
--   * authenticated         : INSERT/UPDATE/DELETE (RLS gates writes)
--   * anon + authenticated  : USAGE/SELECT on sequences, EXECUTE on functions
-- and sets DEFAULT PRIVILEGES so future objects inherit the same grants.
--
-- `schema_migrations` (no RLS, bookkeeping only) is explicitly kept locked.
--
-- Additive & reversible: grants only (no data touched, no drops). Idempotent --
-- re-running GRANT/ALTER DEFAULT PRIVILEGES is a no-op. Rollback = REVOKE the
-- same set (see docs/DEPLOYMENT.md expand/contract notes).
-- =====================================================================

-- Schema access.
grant usage on schema public to anon, authenticated;

-- Read access for both roles (RLS decides visible rows).
grant select on all tables in schema public to anon, authenticated;

-- Write access for authenticated only (RLS decides permitted rows).
grant insert, update, delete on all tables in schema public to authenticated;

-- Sequences (needed for serial/identity inserts, e.g. btc_price_ticks).
grant usage, select on all sequences in schema public to anon, authenticated;

-- RPCs used by public surfaces (leaderboard, top holders, search, etc.).
grant execute on all functions in schema public to anon, authenticated;

-- Keep the migrations bookkeeping table locked (it has no RLS by design).
-- [O2] It exists only where an older tool created it (production); no
-- migration creates it, so on a rebuild from these files (disaster recovery,
-- a new project) the bare REVOKE failed and stopped the rebuild here.
do $$
begin
  if to_regclass('public.schema_migrations') is not null then
    revoke all on table public.schema_migrations from anon, authenticated;
  end if;
end $$;

-- Future objects created by postgres in `public` inherit the same grants.
alter default privileges in schema public
  grant select on tables to anon, authenticated;
alter default privileges in schema public
  grant insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
alter default privileges in schema public
  grant execute on functions to anon, authenticated;
