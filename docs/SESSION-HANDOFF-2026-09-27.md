# Session handoff, 2026-09-27

Carries everything established in the 2026-09-27 session so the next one does not
repeat it. Written because that session could clone but not **push** (see §2), so it
was ended in favour of one with full repository access.

**Evidence grades:** **V** verified in that session by direct execution · **M**
measured · **U** unverified, do not treat as fact.

---

## 1. Read this first: what to do at the start of the new session

1. Start the session **with `petermuchendu1000/kichiko` attached as a source, with write/push access.** That is the entire reason for the move. Verify it before doing any work: `git push --dry-run` on a scratch branch should succeed. If it 403s, the new session has the same limitation and there is no point continuing until it is fixed.
2. **Re-supply the credentials.** They are deliberately not in this file. The previous session's set was to be rotated at its close, so assume it is dead. Needed: `GITHUB_PAT`, `SUPABASE_SERVICE_ROLE`, `ANON_PUBLIC_KEY`, `SUPABASE_DB_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PAT`. Store them the same way: a `chmod 600` file in the session scratchpad, **outside the repo**, sourced per shell call, never echoed.
3. Read [`docs/research/ui-2026-09/20-WORK-PLAN.md`](research/ui-2026-09/20-WORK-PLAN.md). It is the active plan. Its §6 lists six decisions still owed by the user.
4. Do **not** redo the engine research or the UI research. Both are complete and committed. §4 below says what is already settled.

---

## 2. Infrastructure findings (the expensive part to rediscover)

### Supabase: full SQL runs over HTTPS via the Management API

Direct Postgres on **:5432 is firewalled** in the Anthropic sandbox — the egress proxy
tunnels HTTPS only, so `psql` against the pooler times out on all three resolved IPs.
**V**

The workaround, which is complete and worked for everything including DDL: the
Management API query endpoint executes arbitrary SQL **as the `postgres` superuser**.
**V**

```bash
curl -s -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_PAT" \
  -H "Content-Type: application/json" \
  -d '{"query":"select 1"}'
```

Returns rows as JSON, `201` on success. Verified with a full DDL + DML round trip
(create schema → create table → insert → update → delete → select → drop → confirm
zero leftover) in an isolated `_conncheck_tmp` schema. **No production table was
touched.** Use this rather than fighting :5432.

Project ref `uzkphkvzoeypcljntlih`, region eu-west-1, Postgres 17.6,
`ACTIVE_HEALTHY`. PostgREST works with the service-role key; note the REST **root**
endpoint (`/rest/v1/`) accepts *only* the service-role key, so a `401` there from the
anon key is correct behaviour and not a broken key. **V**

### GitHub: the repository is public, and that is why push failed

`git ls-remote` with `credential.helper` emptied and `GITHUB_PAT` unset from the
environment returned `HEAD 23bc0fd9…`, and a fresh unauthenticated `clone` succeeded.
**The repo is world-readable.** **V**

Reads therefore never needed a credential, which is why cloning worked while pushing
did not: the sandbox git proxy refused to inject a credential because the repo was not
in that session's authorized source set (`403`, both on `git push` and on
`api.github.com/repos/…`). `GET /user` succeeded, so the PAT was valid and the block
was path-scoped to the repository.

Exhaustively checked and **not** available as a fix from inside the sandbox: no
`add_repo` tool granted (queried by exact name), no `add_repo`/`ccr`/`gh` binary, no
source management in `/root/.ccr/`, no repo or source subcommand on the `claude` CLI,
and the proxy exposes only `/__agentproxy/status` (everything else `405`). **V**

A **security decision is owed**: the full source is public — all 104 migrations, every
RLS policy, all capability checks, the exact matching-engine logic. A credential scan
of the tracked tree came back **clean** (CI interpolates `${PW}` from GitHub Secrets;
the `localtest@localhost` URLs are throwaway containers the engine README mandates;
`.gitignore` correctly excludes `.env`/`.env.*`; payment secrets are externalised
through 46 environment reads plus the `gateway_secrets` table, hardened by migrations
036, 049, 098). Hygiene is good. One nit: `apps/web/.env.local.template:10` hard-codes
a **stale** project ref `lxqlvshkjbunfsnmbdsp`, not the current project — no password,
low severity, worth replacing. **V**

### Sandbox capabilities

| Capability | State |
|---|---|
| Rust 1.95, `g++` 13.3, `clang++` 18.1 | available — `kengine` builds and benches fine **V** |
| Playwright + Chromium | available at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; never run `playwright install` **V** |
| **Docker** | **unavailable** — so no local Postgres container, and the `[M-GC]` group-commit benchmarks from the engine program **cannot** be reproduced in-sandbox **V** |
| CPU / RAM | 2 vCPU Xeon @2.10 GHz, 7 GB — shared and virtualised, so treat absolute ns figures as noisy; relative comparisons held to within 1% **V** |
| polymarket.com | reachable, HTTP 200 **V** |
| **kalshi.com** | **unreachable** — HTTP 429 Vercel Security Checkpoint (a bot challenge, not plain rate limiting) on three attempts 60s apart. All Kalshi design tokens remain **NOT MEASURED** **V** |

---

## 3. Git state

Branch **`docs/ui-program-2026-09`**, one commit **`8c3f864`**, branched from
`origin/main` at `23bc0fd9`. Contains 25 files: six documents under
`docs/research/ui-2026-09/` plus the Playwright capture harness, raw JSON and
screenshots under `experiments/competitor-capture/`, and this handoff.

It was delivered as a `git bundle`, verified end to end: restored into a fresh clone
with matching HEAD, 25 files, matching PNG sha256, author and both attribution
trailers preserved, `fsck` clean, and byte-identical to the working copy. **V**

If you are reading this in the repo, the push succeeded and nothing further is needed.

---

## 4. Already settled — do not redo

### The engine is done, and it was never the bottleneck

`kengine` builds clean and all 10 tests pass, including the no-allocation hot-path
guarantee and the 073/074 SQL-quirk regressions. Throughput reproduced independently:
**tick ladder 362.0 ns/op vs BTreeMap 452.9 ns/op**, within 1% of the committed
figures (364.3 / 467.9). **V/M**

The decisive number, from the project's own measurements plus that reproduction:

| Stage | Cost | Multiple of the match |
|---|---|---|
| Match in memory (tick ladder) | 362 ns | 1× |
| Postgres commit, batch = 1 | ~1,650,000 ns | ~4,600× |
| Nairobi ↔ Dublin RTT | ~178,000,000 ns | ~492,000× |

The matching step is ~**0.0002%** of end-to-end p50. Driving it to zero would not move
p50 measurably. The book primitive is already at published state of the art (21.5–34
ns/op vs Optiver's 22–33 ns for comparable ops). **Further micro-optimisation of the
matching algorithm has no measurable effect at this venue** — say so plainly if asked
to pursue it again.

The real unbuilt win is **architecture, not algorithm**: application-level group commit
measured 540 orders/s at batch 1 → **10,732/s at batch 100**, and production still runs
the batch-1 in-DB engine at ~500/s. That is Phase 2a/2b in
`docs/research/engine-2026-09/11-ARCHITECTURE-PERSISTENCE-CORRECTNESS.md` §5.6, designed
and not shipped. Note it cannot be *measured* without Docker (see §2).

### Database state is healthy

`supabase_migrations.schema_migrations` = **104 applied, latest `104`**, matching the
repo's 104 files and `main`'s HEAD. Migration 104's `is_active` guard is live in
`place_order_for`. **V**

Two stale artefacts that mislead — fix or document them:

- **`public.schema_migrations` is frozen at 032.** It is a dead legacy table. Any health check reading it reports wrongly. **V**
- **`docs/design/CLOB-SETTLEMENT-2026-09.md` still says "not yet applied to production."** It is applied: migration 069 is in the ledger and none of `resolve_market`, `admin_resolve_market`, `user_settlement`, `void_market` references `total_invested`, so the money-creating defect 1 is fixed in production. **V** (Only defect 1 was positively re-verified; the other seven rest on 069 being applied.)

Live data at the time of writing: 38 markets, 2,291 `clob_orders`, 13,138 `clob_fills`,
74 profiles. **V**

### The UI research program is complete

Four parallel streams, all committed under `docs/research/ui-2026-09/`:
`21-CORPUS-CATALOGUE` (34 docs over 14 surfaces, **23 contradictions**),
`22-UI-AUDIT` (54 routes, no stubs, the ~725 dead-class defect),
`23-COMPETITOR-CAPTURE` (Polymarket measured live, re-runnable),
`24-PSYCHOLOGY` (25 testable rules, ~70 sources), synthesised into `20-WORK-PLAN`.

The three findings that drive the plan:

1. **The UI is structurally complete** — 54 routes, 73 API handlers, no stubs, zero `TODO`s, all live data, a real token system ("Pip") with measured contrast arithmetic backed by a CSS-parsing test. This is a precision programme, not a build.
2. **~725 dead Tailwind classes ship today.** *(Corrected same day: 442 + 8, and the legal-link claim was wrong — see the erratum in `20-WORK-PLAN.md`. Fixed.)* `extend.colors` drops the numeric `green`/`red`/`amber` ramps (283 uses, 41 files) and the shadcn HSL bridge is never mapped (442 uses). **Every link in Terms, Privacy, Responsible-play and Help currently renders with no colour.**
3. **The edge over Polymarket is accessibility, measured.** Their YES tint is **4.36:1** and NO tint **4.28:1** — both fail WCAG AA, and that is their most-rendered semantic treatment. Price-delta green is 2.89:1. **89.8% of mobile home touch targets are under 44px**; the primary feed affordance is a 27px chip. Kichiko's tokens already pass AA in both themes with an enforcing test, and Polymarket served no dark mode at all.

Adopt from them: a **2px** spacing grid (6/10/14px carry 23.6% of usage, so "4px grid"
misdescribes it), borderless shadow-as-border, fixed 180px card heights, hierarchy by
magnitude (price 15px/600 in feed → 28px/600 on detail).

---

## 5. Decisions owed by the user

Blocking, and listed in full in `20-WORK-PLAN.md` §6:

1. **Notation: KES-only or cents/¢?** Every parity doc mandates ¢/$; `COPY-REWRITE-SPEC` mandates `KSh 1,250` and %. Propagates everywhere, so it is Phase 0. Recommendation: **KES and %**.
2. **Fee model** — three live positions (PM's `C·rate·p·(1−p)`, a flat `platform_fee_rate`, and "none on trades").
3. **Does an acquisition event force the landing page earlier?** Otherwise it is Phase 4, not first.
4. **Uganda's minimum gambling age may be 25, not 18** (Lotteries and Gaming Act 2016, secondary source). **U — verify against primary legislation before any Ugandan launch.**
5. **Rewards surface** — four unretracted positions.
6. **Should the repository stay public?** (§2)

---

## 6. Immediate next action

Phase 0 of the work plan, which depends on none of the above except decision 1:

- Map the shadcn HSL bridge into Tailwind and restore the numeric ramps; add a CI check that fails on any class not resolvable to a token.
- Collapse the 23 contradictions into `docs/design/SPEC-OF-RECORD.md`, adding a supersession header to every doc it replaces.
- Re-capture the stale July competitor numbers with the committed harness; retry Kalshi by another route.
- Add the missing `error.tsx` / `loading.tsx` / `not-found.tsx` / `global-error.tsx` (currently zero across 54 pages) and `sitemap.ts` / `robots.ts`.
- Add `viewport-fit=cover` so the seven existing `env(safe-area-inset-bottom)` usages stop being no-ops.

---

## 7. Not verified — do not treat as fact

- All **Kalshi** design tokens (§2).
- Polymarket **dark mode** and its **logged-out auth CTA** (light theme served; US geo-block interstitial served to the sandbox region).
- The UI audit was **static source reading only** — `node_modules` was never installed, so nothing was built or run. Counts are reliable; runtime behaviour is inferred.
- Whether the **PAT carries push scope** — untestable from that session, since the proxy blocked before GitHub saw the token.
- Settlement defects 2–8 (only defect 1 was positively re-verified).
- The solvency-guard check on the resolvers errored on a SQL detail and was not retried.

---

## 8. Addendum — second session, 2026-09-27 (pushed, branch `claude/trusting-clarke-vi106v`)

Push access works. Everything below is on the branch.

**Done (verified on a production build + Chromium):**
- Phase 0.1: all dead Tailwind colour classes resolved; `scripts/check-tailwind-classes.mjs` gates CI. **The audit's "~725 / colourless legal links" was wrong** — true figure 442 + 8, 431 in admin; see erratum in `20-WORK-PLAN.md`. Dark `--primary-foreground` fixed for AA; contrast test covers the HSL bridge.
- Phase 0.4: `error.tsx`, `global-error.tsx`, `not-found.tsx`, `sitemap.ts`, `robots.ts`, per-segment `loading.tsx`. **A root `app/loading.tsx` turns `notFound()` into 200 soft-404s** — measured; never add one.
- Phase 0.5: `viewport-fit=cover`.
- **Decision 1 made by the owner: KES and %.**

**Blocked, and why this session ended:** the container ran on "trusted" network
access. `polymarket.com`, `kalshi.com`, `web.archive.org`, PubMed, ScienceDirect,
bi.team, `*.supabase.co`, even `example.com` → gateway 403 on CONNECT; WebFetch is
blocked the same way. WebSearch works (snippets only). The owner changed the
environment to Full access, but **network policy is fixed at container start**, so
a new session is required. First command in the new session:
`curl -s -o /dev/null -w '%{http_code}\n' https://polymarket.com https://kalshi.com` —
if either is `000`, the setting did not take; stop and tell the owner.

**Owner's brief for the next session (verbatim intent):** borrow the design strengths
of Kalshi and Polymarket, resolve their weaknesses, hybrid approach; weigh how each
handles *every page and element*; deep psychology research ("this matters so much");
clean, professional, responsive, mobile-first, optimized; Apple-level; redesign
allowed; zero guesswork / zero assumptions; **screenshots/visuals from both sites
required**; detailed work plan; answer "do we start with the landing page?".

**Program to run (none of it started):**
1. Capture Kalshi + Polymarket, every page type (home/feed, category, event single +
   multi-outcome, ticket states, confirm, search, portfolio/positions logged-out,
   leaderboard, onboarding/auth, deposit entry, help/legal/responsible-gambling, 404),
   390×844 dpr3 and 1440×900, both themes where offered; screenshots + computed-style
   JSON via the committed harness in `experiments/competitor-capture/`. Kalshi served a
   Vercel bot checkpoint last time: use headed Chromium under `xvfb-run` with a real
   UA; fall back to dated Wayback snapshots, labelled as such.
2. Capture Kichiko at the same viewports with live data (needs Supabase reachable +
   credentials re-supplied per §1.2).
3. Element-by-element matrix: PM vs Kalshi vs Kichiko → adopt / reject / invent, each
   with evidence.
4. Psychology from **primary sources only** (full text, exact n/effect sizes), mapped to
   elements and to the East African context. Re-verify every rule in `24-PSYCHOLOGY`.
   Known correction already: BIT 2022's simpler-odds effect held for non-problem
   gamblers **but not problem gamblers** — rule 1 overstates it.
5. Supersede `20-WORK-PLAN` with a v2; publish a visual comparison page.
