# Coding Standards

> Module 17.5. Conventions that keep the codebase consistent, safe, and easy to
> evolve. Enforced by TypeScript, ESLint (incl. `jsx-a11y`), and review.

## Language & tooling

- **TypeScript strict**, no `any` unless justified with a comment. Prefer precise
  types; derive DB types from `types/supabase.ts` (`Tables`, `TablesInsert`,
  `TablesUpdate`, `Enums`).
- **ESLint** (`next/core-web-vitals` + `jsx-a11y`). Errors block CI; the few
  `warn`-level rules are tracked debt (see `docs/a11y/`).
- Format consistently (Prettier-style); no unused exports/vars.

## Architecture conventions

- **Next.js App Router.** Server Components by default; add `'use client'` only
  when you need interactivity/state. Data fetching stays on the server where
  possible.
- **Route handlers** validate input with **zod**, return typed JSON, and use the
  right Supabase client:
  - RLS-scoped user client (`@/lib/supabase/server` `createClient`) for
    user-owned data — **preserves row-level security**.
  - Admin client (`createAdminClient`) only for privileged server operations.
- **Auth/RBAC:** gate user routes with `requireUser`; gate admin routes with
  `requireCapability('<cap>')` (never ad-hoc role string checks).
- **Money is decimal-precise** — use the currency module (`lib/currency.ts`);
  never float-math money. Balance mutations go through atomic RPCs (e.g.
  `clob_place_order`), never multi-step client writes.

## Formatting & i18n

- No hard-coded user-facing strings — use catalog keys (`next-intl`).
- No ad-hoc `toLocaleString()` / hand-built dates — use `lib/format.ts` and
  `formatCurrency`. See `docs/i18n/TRANSLATION.md`.
- Prefer **CSS logical properties** (`ms-*`/`me-*`, `text-start`) for RTL-readiness.

## Accessibility (non-negotiable)

- Semantic landmarks (`header`/`nav`/`main`/`footer`); one `main`.
- Icon-only controls need `aria-label`; form fields need associated labels.
- Keyboard operable; visible focus (`focus-visible`); respect
  `prefers-reduced-motion`; never encode meaning in colour alone.

## Security

- Validate & sanitize all input (zod at the boundary). Never trust client data.
- Secrets only via env (`ENVIRONMENT.md`); never log secrets or PII.
- Verify webhook signatures; gate cron with `CRON_SECRET`.
- Rate-limit sensitive/mutating routes (middleware).

## Errors, logging, observability

- Fail loudly server-side, gracefully client-side. Return structured
  `{ error, details? }` from handlers.
- Use structured logging; wrap background jobs in the `job_runs` recorder.
- Report to Sentry (`SENTRY_DSN`); emit web-vitals telemetry.

## Tests

- New logic ships with unit tests; see [`TESTING.md`](./TESTING.md).
