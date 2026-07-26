# Contributing

> Module 17.5. How to make changes to Kichiko safely.

## Workflow

1. **Sync `main`** and create a branch (or, per this project's fast cadence,
   commit small, verified increments directly to `main` behind green gates).
2. Make a **focused change** — one concern per commit/PR.
3. Run the **local gates** (see below) until green.
4. **Commit** with a clear message (see format). Update docs in the *same* change
   when behaviour, endpoints, env, or schema change.
5. Open a PR (or push) — CI must be green before merge/deploy.

## Local gates (run before every commit)

```bash
npm run type-check
npm run lint
cd apps/web && npm test && cd ../..
npm run i18n:check && npm run i18n:pseudo:check
python3 scripts/lint_migrations.py
```

For UI changes, also: `cd apps/web && npm run test:a11y` and re-run
`npm run i18n:pseudo` if you touched `messages/en.json`.

## Commit message format

```
Module <n>.<sub> (<area>): <imperative summary>

- bullet of what changed and why
- gates: what you verified (type-check, lint, tests, build)
```

Example: `Module 17.4 (l10n): pseudo-locale + preferred_locale persistence`.

## Definition of done

- [ ] Code + tests in the same change; unit tests cover new logic.
- [ ] `type-check`, `lint`, `unit`, `build` green locally.
- [ ] Schema change → new migration + `db:types` regenerated + `migration-lint` green.
- [ ] New/changed endpoint → `docs/api/README.md` (+ `openapi.yaml` if public/user).
- [ ] New env var → `apps/web/.env.example` + `docs/developer/ENVIRONMENT.md`.
- [ ] User-facing copy → catalog keys (no hard-coded English); `i18n:check` green.
- [ ] UI → accessible (labels, keyboard, focus, contrast); axe clean.
- [ ] Docs updated (this is enforced — docs rot is a launch risk).

## Coding standards & migrations

See [`CODING-STANDARDS.md`](./CODING-STANDARDS.md) and
[`MIGRATIONS.md`](./MIGRATIONS.md).

## Getting set up

New here? Start with [`SETUP.md`](./SETUP.md).
