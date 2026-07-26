# Database Migrations — Conventions

> Module 17.5. How schema change is done in Kichiko. Enforced by
> `scripts/lint_migrations.py` (CI `migration-lint` job).

## Where & how

- Migrations live in `supabase/migrations/` as `NNN_snake_name.sql`
  (`001` … `018` today). They are **forward-only**, applied in numeric order.
- Apply locally with `npm run db:reset` (fresh: all migrations + seed) or
  `supabase db push`. Regenerate types after: `npm run db:types`.

## Rules (all CI-enforced)

1. **Naming** — files must match `NNN_snake_name.sql` (3+ digit prefix).
2. **Numbering** — prefixes are **strictly increasing, unique, and gapless**.
   The next migration is `019_…`.
3. **Parseable** — each file must parse (pglast). Invalid SQL fails CI.
4. **Destructive opt-in** — any `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, or
   `DROP SCHEMA` must carry an explicit `-- migration:allow-destructive` comment.
   This forces a conscious decision on data-loss operations.

## Authoring guidelines

- **Idempotent where possible:** `IF NOT EXISTS` / `IF EXISTS`, and
  drop-then-create for constraints so re-runs are deterministic (see
  `018_preferred_locale.sql`).
- **Never break existing data:** add columns with sensible `DEFAULT`s;
  back-fill in the same migration; add `NOT NULL` only after back-fill.
- **RLS:** new user-facing tables need row-level security policies. Reuse the
  `auth.uid()` ownership pattern; don't rely on the service-role client to
  substitute for RLS.
- **Guard optional extensions** in `DO` blocks so a migration never fails on an
  environment lacking an extension (see `017_perf_indexes.sql` /
  `pg_stat_statements`).
- **Keep migrations transaction-safe** (avoid `CREATE INDEX CONCURRENTLY` inside
  the migration transaction).
- **Document intent** with a header comment block (module, what & why), matching
  the existing migration style.
- **Keep types in sync:** after changing schema, regenerate
  `apps/web/types/supabase.ts` (`npm run db:types`) — or hand-edit the affected
  Row/Insert/Update if the local Supabase stack isn't available, and note it.

## Checklist

- [ ] File named `NNN_…` with the next number, gapless.
- [ ] Parses; `python3 scripts/lint_migrations.py` green.
- [ ] Destructive ops carry the opt-in marker (or avoided).
- [ ] Additive & back-filled; no data loss for existing rows.
- [ ] RLS policies added for new user tables.
- [ ] `types/supabase.ts` regenerated; app `type-check` green.
