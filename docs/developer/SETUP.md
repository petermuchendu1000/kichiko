# Developer Setup — clone → running locally

> Module 17.5. Get Kichiko running on your machine from a fresh clone. If you
> follow this top-to-bottom you'll have the app, database, and tests working.

## Prerequisites

- **Node.js 20+** and **npm** (repo is an npm workspace: `apps/*`).
- **Supabase CLI** (`supabase`) — local Postgres + auth + storage stack.
- **Docker** — required by the Supabase local stack.
- (Optional) **Terraform** for infra (`infra/`), **k6** for load tests.

## 1. Clone & install

```bash
git clone https://github.com/petermuchendu1000/kichiko.git
cd kichiko
npm ci            # installs the workspace (apps/web)
```

## 2. Configure environment

```bash
cp apps/web/.env.example apps/web/.env.local
```

Fill in the values. For pure local dev you only need the Supabase local keys
(printed by `supabase start`) and `NEXT_PUBLIC_APP_URL=http://localhost:3000`.
Payment/FX/email/SMS/Redis keys are only needed to exercise those flows. Full
matrix: [`ENVIRONMENT.md`](./ENVIRONMENT.md).

## 3. Start the database

```bash
npm run supabase:start        # boots local Postgres/auth/storage (Docker)
npm run db:reset              # applies supabase/migrations/*.sql + seed
```

`db:reset` runs every migration `001 → 018` in order and seeds sample data.
Regenerate DB types after a schema change:

```bash
npm run db:types             # writes apps/web/types/supabase.ts
```

## 4. Run the app

```bash
npm run dev                  # Next.js dev server on http://localhost:3000
```

You should see the styled home page with the navbar, markets grid, footer
(with the language switcher), and a working skip-to-content link.

## 5. Verify your setup (the quality gates)

```bash
npm run type-check           # tsc --noEmit
npm run lint                 # next lint (jsx-a11y enabled)
npm test  --workspace ...    # or: cd apps/web && npm test   (vitest, 400+ tests)
npm run i18n:check           # catalog integrity
npm run i18n:pseudo:check    # pseudo-locale in sync
python3 scripts/lint_migrations.py   # migration naming/parse/destructive-opt-in
```

Optional / heavier:

```bash
cd apps/web && npm run test:e2e      # Playwright (needs `npx playwright install`)
cd apps/web && npm run test:a11y     # axe accessibility scan
```

## Troubleshooting

- **Supabase won't start:** ensure Docker is running; `supabase stop` then retry.
- **Type errors after schema change:** re-run `npm run db:types`.
- **Auth/session issues locally:** confirm the anon/service keys in `.env.local`
  match `supabase start` output and `NEXT_PUBLIC_APP_URL` is correct.
- **Build works but pages 500:** you're likely missing a required env var — check
  the [environment matrix](./ENVIRONMENT.md).

## Where things live

See [`docs/01-ARCHITECTURE.md`](../01-ARCHITECTURE.md) for the system design and
[`README.md`](../../README.md) for the directory map. API surface:
[`docs/api/README.md`](../api/README.md).
