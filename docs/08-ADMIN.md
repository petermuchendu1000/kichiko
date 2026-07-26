# Kichiko — Admin Module (Control Plane)

> **Status:** Specification / rewrite. Supersedes the placeholder admin page
> (`apps/web/app/admin/page.tsx`) and the one-line Module 11 entry in
> `03-ROADMAP.md`. This document is the single source of truth for the admin
> control plane: what it must do, its data model, routes, permissions, and
> rollout plan.

---

## 1. Why this rewrite

### 1.1 Current state (what exists today)

The admin surface is a **single read-only page** with almost no control:

- `apps/web/app/admin/page.tsx` — 4 stat counters (users, active markets,
  pending markets, pending deposits), a "recent bets" list, and three cards
  linking to `/admin/markets`, `/admin/users`, `/admin/transactions` —
  **none of which exist**.
- RBAC is limited to `user_role = user | admin | moderator | resolver`
  (`supabase/migrations/001_initial_schema.sql`). `is_admin()` returns true only
  for `admin`/`moderator`. There is no notion of a **marketer** or a first-class
  **creator** operator role, and no fine-grained permissions.
- **Every payment gateway credential is a hardcoded environment variable**
  (`MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CONSUMER_KEY/SECRET`,
  `MTN_MOMO_*`, `AIRTEL_MONEY_*`, `PESAPAL_*`). There is **no way to view,
  edit, rotate, enable/disable, or sandbox-toggle a paybill/gateway from the UI**
  — a deploy is required for every change.
- `audit_log` exists in the schema but nothing writes an admin surface for it.
- No user management, no creator/marketer management, no financial operations
  console, no settings, no compliance queue, no content moderation.

### 1.2 Target state (what we are building)

A **comprehensive, role-aware control plane** where operators run the entire
platform without touching code or redeploying:

1. **Users** — every system user (traders, creators, marketers, staff): search,
   inspect, edit, assign roles/permissions, suspend/close, reset, impersonate
   (audited), review KYC.
2. **Creators** — the people who author markets: applications/approval, creator
   tiers, reward configuration, performance, and payout of `creator_reward`.
3. **Marketers** — affiliates/growth operators: referral & promo-code programs,
   attribution, commission tiers, payout runs, campaign management.
4. **Markets** — review/approve/reject, resolve, cancel/refund, feature/trend,
   dispute handling.
5. **Finance** — deposits, withdrawals (approve/reject/retry), the money ledger,
   fees, reconciliation and exports.
6. **Payment gateways** — DB-backed, encrypted, per-provider **and** per-country
   configuration (paybill/shortcode, keys, passkeys, callback URLs,
   sandbox/production, enable/disable, connection test) — all from the UI.
7. **System settings** — fees, limits, currencies & FX, feature flags,
   maintenance mode, announcements.
8. **Compliance** — KYC queue, AML flags, sanctioned-list checks, self-exclusion.
9. **Content moderation** — markets, comments, profiles, reports.
10. **Observability** — audit log, admin activity, security events, health.

**Design rule:** everything an operator can control is a **record in the
database governed by RLS + audit**, not a code constant. The only things that
stay in secret stores are the raw cryptographic secrets referenced by settings
(see §7.3).

---

## 2. Roles, permissions & access model

### 2.1 Role taxonomy (extends the existing `user_role` enum)

The current enum is `('user','admin','moderator','resolver')`. We extend it and
layer **granular permissions** on top so we never hardcode role → capability
checks in more than one place.

| Role | Purpose | Typical scope |
|---|---|---|
| `user` | Regular trader | Own data only |
| `creator` | Authors markets (elevated user) | Own markets + creator console |
| `marketer` | Affiliate / growth operator | Own referral & campaign data + marketer console |
| `resolver` | Resolves market outcomes | Market resolution queue |
| `support` | Tier-1 operations | Read users/tx, KYC review, limited actions |
| `finance` | Payments & ledger operator | Deposits/withdrawals, reconciliation, gateway read |
| `moderator` | Content & market governance | Markets, comments, reports |
| `admin` | Platform administrator | Everything except owner-only |
| `superadmin` | Owner / break-glass | Everything incl. gateway secrets, role grants, settings |

> Migration note: `creator`, `marketer`, `support`, `finance`, `superadmin` are
> **new** values added to `user_role` (see §6.1). `creator`/`marketer` are
> **user-facing elevated roles**; `support`/`finance`/`moderator`/`admin`/
> `superadmin` are **staff roles**.

### 2.2 Permission matrix (capabilities)

Capabilities are strings (`resource:action`) stored per role in
`role_permissions`, so we can tune access without shipping code.

| Capability | support | finance | moderator | admin | superadmin |
|---|:--:|:--:|:--:|:--:|:--:|
| `users:read` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `users:update` | ⛔ | ⛔ | ⛔ | ✅ | ✅ |
| `users:suspend` | ✅ | ⛔ | ✅ | ✅ | ✅ |
| `users:role_grant` | ⛔ | ⛔ | ⛔ | ⚠️ non-staff | ✅ |
| `users:impersonate` | ⛔ | ⛔ | ⛔ | ✅ | ✅ |
| `kyc:review` | ✅ | ⛔ | ✅ | ✅ | ✅ |
| `creators:manage` | ⛔ | ⛔ | ✅ | ✅ | ✅ |
| `marketers:manage` | ⛔ | ✅ | ✅ | ✅ | ✅ |
| `markets:approve` | ⛔ | ⛔ | ✅ | ✅ | ✅ |
| `markets:resolve` | ⛔ | ⛔ | ✅ | ✅ | ✅ |
| `markets:cancel` | ⛔ | ⛔ | ✅ | ✅ | ✅ |
| `finance:deposits` | ⛔ | ✅ | ⛔ | ✅ | ✅ |
| `finance:withdrawals` | ⛔ | ✅ | ⛔ | ✅ | ✅ |
| `finance:ledger` | ⛔ | ✅ | ⛔ | ✅ | ✅ |
| `payouts:run` | ⛔ | ✅ | ⛔ | ✅ | ✅ |
| `gateways:read` | ⛔ | ✅ | ⛔ | ✅ | ✅ |
| `gateways:write` | ⛔ | ⛔ | ⛔ | ⚠️ non-secret | ✅ |
| `gateways:secrets` | ⛔ | ⛔ | ⛔ | ⛔ | ✅ |
| `settings:write` | ⛔ | ⛔ | ⛔ | ✅ | ✅ |
| `audit:read` | ⛔ | ✅ | ✅ | ✅ | ✅ |

⚠️ = allowed but with guardrails (admins cannot grant/revoke *staff* roles or
edit gateway *secret* material — those are superadmin-only, break-glass).

### 2.3 Enforcement layers (defence in depth)

1. **Edge middleware** (`apps/web/middleware.ts`) — blocks `/admin/*` for anyone
   without a staff role; already gates on `admin`/`moderator`, to be widened to
   the staff set.
2. **Server guards** (`apps/web/lib/auth.ts`) — extend `requireRole` with a new
   `requireCapability(cap)` helper reading `role_permissions`.
3. **Row-Level Security** — Postgres RLS is the final backstop; the existing
   `is_admin()` is complemented by `has_capability(cap text)` (§6.4).
4. **Audit** — every mutating admin action writes `audit_log` (actor, action,
   entity, before/after, IP, UA).

---

## 3. Information architecture (routes)

All under `apps/web/app/admin/*`, rendered server-side (`force-dynamic`), guarded
by capability. A persistent left nav + top command bar; each section deep-links.

```
/admin                         Overview & KPIs
/admin/users                   All system users (search/filter/segment)
/admin/users/[id]              User detail (profile, wallet, KYC, activity, actions)
/admin/creators                Creator directory + applications
/admin/creators/[id]          Creator detail (markets, rewards, payouts, tier)
/admin/marketers               Marketer/affiliate directory + applications
/admin/marketers/[id]         Marketer detail (referrals, campaigns, commissions)
/admin/marketers/payouts       Commission payout runs
/admin/markets                 Market queue (review/approve/reject)
/admin/markets/[id]           Market detail (edit, resolve, cancel, feature)
/admin/markets/disputes        Dispute queue
/admin/finance                 Financial overview
/admin/finance/deposits        Deposits console
/admin/finance/withdrawals     Withdrawals console (approve/reject/retry)
/admin/finance/ledger          Money ledger + reconciliation + exports
/admin/settings                System settings (fees, limits, flags, maintenance)
/admin/settings/currencies     Currencies & exchange rates
/admin/settings/gateways       Payment gateway integrations (paybill & settings)
/admin/settings/gateways/[id] Single gateway config + test + secret rotation
/admin/kyc                     KYC / compliance queue
/admin/moderation              Content moderation (markets, comments, reports)
/admin/announcements           Broadcast announcements / system notifications
/admin/audit                   Audit log & security events
/admin/staff                   Staff & role management (admin+)
```

---

## 4. Feature specifications

### 4.1 Overview (`/admin`)

Operational cockpit, all live:

- **KPI cards**: total users (+Δ 7d), active/pending markets, pending KYC,
  pending withdrawals, deposits today, gross volume (USD), platform fee revenue,
  outstanding creator/marketer payout liability.
- **Attention queues**: pending market approvals, KYC awaiting review, failed
  withdrawals, disputed markets, flagged content, failed gateway callbacks.
- **Charts**: volume & revenue (30d), new users, deposit/withdrawal net flow,
  provider mix (M-Pesa / MTN / Airtel / PesaPal), by-country breakdown.
- **System health**: gateway connectivity, background-job last-run, FX freshness.

### 4.2 User management (`/admin/users`)

The console for **every system user**, regardless of role.

**List/segment** — server-side search over `profiles` (username, display_name,
phone, email via `auth.users`, referral_code); filters by `role`,
`account_status`, `kyc_status`, `country_code`, `preferred_currency`, date
joined, volume band; saved segments; CSV export.

**Detail (`/admin/users/[id]`)** — tabs:
- *Profile*: identity, country, currency, timestamps, denormalized stats
  (`total_volume_usd`, `total_bets`, win_rate, `profit_loss_usd`).
- *Wallet*: balances per currency, available vs reserved, adjust with reason
  (writes a `transaction` of type `bonus`/`fee` + audit; never a silent edit).
- *KYC*: documents (private `kyc-documents` bucket), status, review actions.
- *Activity*: orders, positions, transactions, logins, notifications.
- *Roles & permissions*: assign role (guardrailed per §2.2), effective caps.
- *Referrals*: who they referred / who referred them.

**Actions** (all audited): suspend / reactivate / close account; force logout;
reset password (Supabase Auth admin); verify/reset phone; adjust balance (with
reason); grant/revoke role; **impersonate** (time-boxed, banner, fully audited);
send targeted notification; add internal note.

### 4.3 Creator management (`/admin/creators`)

Creators are users who author markets (`markets.creator_id`) and earn the
0.25% `creator_reward` carved from platform fees (see Module 4 in the roadmap).

- **Applications**: promote a `user` → `creator` on approval (or auto-tier by
  reputation). Application review with notes.
- **Creator tiers**: configurable reward rate & privileges per tier
  (e.g. bronze/silver/gold → auto-approve markets, higher creation limits).
- **Directory**: markets authored, volume driven, resolution accuracy, dispute
  rate, lifetime `creator_reward` earned & paid.
- **Controls**: suspend creator privileges, cap concurrent open markets,
  require review vs. auto-publish, revoke to `user`.
- **Payouts**: accrued creator rewards → payout run (reuses the withdrawal /
  disbursement rails), with statement export.

### 4.4 Marketer management (`/admin/marketers`)

Marketers are growth/affiliate operators driving signups and volume via referral
codes and promo campaigns. Builds on the existing `profiles.referral_code` /
`referred_by` / `referral_count` and `referrals` table.

- **Applications & onboarding**: promote `user` → `marketer`; assign a unique
  tracking code / campaign codes.
- **Attribution**: referred users, activation (first deposit / first bet),
  retained volume attributed to the marketer.
- **Commission plans**: configurable models (CPA per activated user, revenue
  share on platform fees, hybrid), tiered by performance, per-country overrides.
- **Campaigns**: create promo codes (deposit bonus, fee discount) with budget,
  caps, validity windows, and per-campaign performance.
- **Payout runs (`/admin/marketers/payouts`)**: compute accrued commissions for
  a period → review → approve → disburse via payment rails → statement.
- **Anti-fraud**: self-referral / multi-account detection, clawback on
  chargeback/refund, hold periods.

### 4.5 Market management (`/admin/markets`)

- **Review queue**: `draft`/`pending` markets → approve (`active`) / reject /
  request changes; validates trading window & `resolves_at ≥ closes_at`
  (already enforced server-side).
- **Detail**: edit metadata (title/description/tags/category/cover), feature /
  trend toggles (`is_featured`, `featured_order`, `is_trending`), close early.
- **Resolution**: for `resolver`+ roles, resolve outcome via the atomic
  `resolve_market` RPC → triggers payouts; audit trail of resolution source.
- **Cancel/refund**: `cancel_market` RPC → all bets refunded atomically.
- **Disputes (`/admin/markets/disputes`)**: `disputed` markets, evidence,
  re-resolution or upholding, with SLA tracking.

### 4.6 Financial management (`/admin/finance`)

- **Deposits console**: list `deposits` by status/provider/country; inspect
  provider payload; manually reconcile a stuck deposit; the credit path stays
  the atomic idempotent `credit` function.
- **Withdrawals console**: approve / reject / retry `withdrawals`; the atomic
  reserve → complete/fail flow and async disbursement already exist (Module 7);
  admin adds review, limits, and manual retry of failed disbursements.
- **Ledger & reconciliation (`/admin/finance/ledger`)**: unified `transactions`
  view (deposit, withdrawal, bet_placed/won/lost/refunded, fee, bonus,
  referral_bonus, creator_reward); daily balances; provider settlement
  reconciliation; CSV/accounting export.
- **Fees & revenue**: platform fee, creator reward, marketer commission
  breakdown over time.

### 4.7 Payment gateway integrations (`/admin/settings/gateways`) ⭐

The headline gap. Today paybill/shortcode/keys/passkeys are **env-only**. We
move gateway configuration into a **DB-backed, encrypted, per-provider &
per-country** model editable from the UI, with test + rotation, without a deploy.

**Providers** (existing `payment_provider` enum): `mpesa`, `mtn_momo`,
`airtel_money`, `pesapal`, `bank_transfer`, `internal`.

**Per-gateway configuration UI** exposes:

- **Identity & scope**: provider, country/currency this config applies to,
  human label, environment (`sandbox` | `production`).
- **M-Pesa (Daraja)**: `business_shortcode` / **paybill**, `party_b`,
  `consumer_key`, `consumer_secret`, `passkey`, `initiator_name`,
  `security_credential`, B2C shortcode, transaction type
  (`CustomerPayBillOnline` / `CustomerBuyGoodsOnline`), STK & B2C callback URLs.
- **MTN MoMo**: subscription/collection key, disbursement key, API user, API key,
  target environment.
- **Airtel Money**: client_id, client_secret, disbursement PIN, callback URL,
  base URL.
- **PesaPal**: consumer_key, consumer_secret, IPN URL/ID, base URL.
- **Common**: enable/disable toggle, priority/failover order per country, min/max
  amount, per-transaction & daily limits, maintenance flag.

**Behaviours**:
- **Connection test** — "Test connection" performs a live auth/token call
  (sandbox-safe) and reports success/latency, writing a `gateway_health` row.
- **Secret handling** — secret fields are **write-only** in the UI (masked,
  never returned); values are encrypted at rest (`pgsodium`/Vault) and only
  decrypted server-side at call time. `gateways:secrets` (superadmin) required to
  set/rotate; `gateways:write` (admin) can edit non-secret fields.
- **Rotation** — rotate a secret without downtime; old value retained until the
  new one passes a test; every change audited (who/when, not the value).
- **Migration/back-compat** — a config resolver reads DB first and falls back to
  the current env vars, so nothing breaks during rollout. Payment libs
  (`lib/payments/*`) switch from reading `process.env` directly to
  `getGatewayConfig(provider, country, env)`.

### 4.8 System settings (`/admin/settings`)

Everything platform-wide, DB-backed (`platform_settings` key/value with typed
schema + audit):

- **Fees & economics**: platform fee %, creator reward %, marketer commission
  defaults, min bet, payout rounding.
- **Limits**: deposit/withdrawal min/max, daily caps, KYC thresholds (limits by
  `kyc_status`), max open markets per creator.
- **Currencies & FX (`/admin/settings/currencies`)**: enable currencies
  (`currency_code`), manage `exchange_rates`, set FX source & refresh cadence,
  manual override with expiry.
- **Feature flags**: toggle features (new-market creation, withdrawals, specific
  providers, leaderboard) without a deploy.
- **Maintenance mode**: banner + read-only/withdrawal-freeze switches.
- **Branding/content**: support email, legal links, home hero copy.

### 4.9 KYC & compliance (`/admin/kyc`)

- Review queue over `kyc_documents` + `profiles.kyc_status`; approve/reject with
  reason → flips status and notifies (existing `admin_review_kyc` path,
  `kyc_approved`/`kyc_rejected` notifications).
- AML/risk flags, sanctioned-name screening hook, tiered limits by KYC level,
  self-exclusion / responsible-gaming controls.

### 4.10 Content moderation (`/admin/moderation`)

- Reported markets, comments (`comments`, soft-delete via `is_deleted`),
  profiles; take-down/restore, warn/ban user; report inbox with SLA.

### 4.11 Announcements (`/admin/announcements`)

- Compose broadcast or segmented `system_announcement` notifications (all users,
  by country/role/segment); schedule; delivery stats. Uses existing
  notifications infra (in-app + SMS via Africa's Talking + email via Resend).

### 4.12 Audit & security (`/admin/audit`)

- Searchable `audit_log` (actor, action, entity_type/id, before/after JSON, IP,
  UA, time); filter by actor/entity/date; export.
- Security events: failed logins, role changes, impersonation sessions, gateway
  secret rotations, settings changes.

---

## 5. UX & non-functional requirements

- **Responsive** admin shell (usable ≥400px; richer multi-column at `md:`),
  dark-mode aware, Tailwind utilities per the design system.
- **Server-side** pagination/sort/filter for every large list; never load full
  tables client-side.
- **Optimistic-safe** mutations with concurrency guards (as markets already do).
- **Every destructive action** requires a confirm + reason and is audited.
- **Accessibility**: keyboard nav, focus states, semantic tables.
- **Exports** (CSV) on users, transactions, ledger, payouts.

---

## 6. Data model changes

New/changed objects (delivered as ordered `supabase/migrations/*` files with RLS
+ policies + audit triggers).

### 6.1 Extend roles

```sql
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'creator';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'marketer';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'support';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'finance';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'superadmin';
-- ('user','admin','moderator','resolver' already exist)
```

### 6.2 Permissions

```sql
CREATE TABLE public.role_permissions (
  role        user_role NOT NULL,
  capability  TEXT      NOT NULL,   -- e.g. 'gateways:write'
  PRIMARY KEY (role, capability)
);
```

### 6.3 Payment gateway configuration (replaces env-only)

```sql
CREATE TABLE public.payment_gateways (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider      payment_provider NOT NULL,
  country_code  CHAR(2),                       -- NULL = global default
  currency      currency_code,
  label         TEXT NOT NULL,
  environment   TEXT NOT NULL DEFAULT 'sandbox', -- 'sandbox' | 'production'
  is_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  priority      INT NOT NULL DEFAULT 100,       -- failover ordering
  config        JSONB NOT NULL DEFAULT '{}',    -- non-secret: shortcode/paybill, base_url, callbacks, limits
  secret_ref    JSONB NOT NULL DEFAULT '{}',    -- encrypted refs to keys/passkeys/secrets (never plaintext)
  min_amount    NUMERIC(20,6),
  max_amount    NUMERIC(20,6),
  created_by    UUID REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (provider, country_code, environment)
);

CREATE TABLE public.gateway_health (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gateway_id  UUID REFERENCES public.payment_gateways(id) ON DELETE CASCADE,
  ok          BOOLEAN NOT NULL,
  latency_ms  INT,
  detail      TEXT,
  checked_at  TIMESTAMPTZ DEFAULT NOW()
);
```

> Secret material (`consumer_secret`, `passkey`, `security_credential`, PINs,
> API keys) is stored encrypted (`pgsodium`/Supabase Vault) and referenced from
> `secret_ref`; the raw values are never selectable via RLS and never returned to
> the client.

### 6.4 Platform settings, creators, marketers, payouts

```sql
CREATE TABLE public.platform_settings (
  key         TEXT PRIMARY KEY,          -- 'fees.platform_pct', 'limits.withdraw_max', ...
  value       JSONB NOT NULL,
  updated_by  UUID REFERENCES public.profiles(id),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.creator_profiles (
  user_id       UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  tier          TEXT NOT NULL DEFAULT 'bronze',
  reward_pct    NUMERIC(6,4),            -- overrides default creator reward
  auto_publish  BOOLEAN NOT NULL DEFAULT FALSE,
  status        TEXT NOT NULL DEFAULT 'active', -- active|suspended|revoked
  approved_by   UUID REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.marketer_profiles (
  user_id        UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  tracking_code  TEXT UNIQUE NOT NULL,
  commission_plan JSONB NOT NULL DEFAULT '{}', -- model + rates + country overrides
  status         TEXT NOT NULL DEFAULT 'active',
  approved_by    UUID REFERENCES public.profiles(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.payout_runs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind        TEXT NOT NULL,             -- 'creator' | 'marketer'
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft', -- draft|approved|disbursed|failed
  total_usd   NUMERIC(20,6) DEFAULT 0,
  created_by  UUID REFERENCES public.profiles(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.payout_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id      UUID REFERENCES public.payout_runs(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES public.profiles(id),
  amount_usd  NUMERIC(20,6) NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  detail      JSONB
);
```

### 6.5 RLS helper

```sql
CREATE OR REPLACE FUNCTION public.has_capability(cap TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role_permissions rp ON rp.role = p.role
    WHERE p.id = auth.uid() AND rp.capability = cap
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;
```

All admin tables get RLS policies of the form
`USING (public.has_capability('<cap>'))`.

---

## 7. API & security

### 7.1 Route handlers (`apps/web/app/api/admin/*`)

Each guarded by `requireCapability` and audited. Representative set:

```
GET    /api/admin/users            list/search/segment
PATCH  /api/admin/users/[id]       update profile/role/status
POST   /api/admin/users/[id]/impersonate
POST   /api/admin/users/[id]/adjust-balance
POST   /api/admin/kyc/[id]/review
POST   /api/admin/markets/[id]/approve | reject | resolve | cancel | feature
GET    /api/admin/finance/deposits | withdrawals | ledger
POST   /api/admin/finance/withdrawals/[id]/approve | reject | retry
GET    /api/admin/gateways ; POST /api/admin/gateways ; PATCH /api/admin/gateways/[id]
POST   /api/admin/gateways/[id]/test        live connection test
POST   /api/admin/gateways/[id]/rotate-secret
GET/PUT /api/admin/settings ; /api/admin/settings/currencies
POST   /api/admin/creators/[id]/approve|suspend|revoke ; /payouts/run
POST   /api/admin/marketers/[id]/approve|suspend ; /payouts/run
GET    /api/admin/audit
```

### 7.2 Server helpers

Extend `apps/web/lib/auth.ts`:

```ts
export async function requireCapability(cap: string): Promise<GuardResult>
export async function hasCapability(ctx: AuthContext, cap: string): Promise<boolean>
```

Add `apps/web/lib/admin/gateways.ts`:

```ts
// DB-first resolver with env fallback (back-compat during rollout)
export async function getGatewayConfig(
  provider: PaymentProvider, country?: string, env?: 'sandbox'|'production'
): Promise<ResolvedGatewayConfig>
```

### 7.3 Security rules

- **Least privilege**: `gateways:secrets` and staff-role grants are
  superadmin-only (break-glass); everything else is capability-gated.
- **Secrets** are encrypted at rest, write-only from UI, decrypted only
  server-side at call time; **never** logged or returned. Env vars remain the
  fallback source and the place for the master encryption key.
- **Impersonation** is time-boxed, banner-flagged, and fully audited.
- **Every mutation** writes `audit_log` with before/after and request context.
- **Rate-limit** admin mutations; require re-auth / 2FA for high-risk actions
  (role grants, secret rotation, balance adjustments, payout disbursement).

---

## 8. Rollout plan (phased)

| Phase | Scope | Gate |
|---|---|---|
| **A. Foundation** | Role enum extension, `role_permissions`, `has_capability`, `requireCapability`, widen middleware to staff set, admin shell + nav | RBAC unit tests; unauthorized `/admin/*` blocked |
| **B. Users & KYC** | `/admin/users`, user detail, actions, KYC queue | Suspend/role/KYC flows audited; RLS verified |
| **C. Markets & Finance** | Market review/resolve/cancel, deposits/withdrawals consoles, ledger | Resolution→payout; withdrawal approve/retry; reconciliation export |
| **D. Gateways & Settings** ⭐ | `payment_gateways`, encrypted secrets, gateway UI + test + rotation, env fallback resolver, `platform_settings`, currencies/FX, feature flags | Edit paybill/keys from UI (no deploy); live test passes; secrets never leak; env fallback intact |
| **E. Creators & Marketers** | Creator/marketer consoles, tiers, commission plans, campaigns, payout runs | Approvals audited; payout run disburses via rails; anti-fraud checks |
| **F. Moderation, Announcements, Audit** | Content moderation, broadcast announcements, audit/security console | Take-down/restore; segmented broadcast; audit search/export |

Each phase ships with: migrations (RLS + policies + audit triggers), route
handlers, server components, and tests (unit for guards/capabilities, DB e2e for
critical flows), consistent with the project's existing test gates.

---

## 9. Acceptance criteria (definition of done)

1. **No dead links** — every card/route in `/admin` resolves to a real, guarded
   page.
2. **Role/permission model** live: capabilities enforced at middleware, server
   guard, and RLS; staff-role grants and gateway secrets are superadmin-only.
3. **Full user management**: search/segment all users; edit role/status; suspend;
   KYC review; audited impersonation; balance adjustment with reason.
4. **Creators & marketers** manageable end-to-end incl. approval, tiers/plans,
   and payout runs that disburse via existing rails.
5. **Payment gateways fully configurable from the UI** — view/edit paybill,
   shortcode, keys, passkeys, callbacks, limits; enable/disable; sandbox↔
   production; live connection test; secret rotation — **with zero redeploys**,
   secrets encrypted and never exposed, env fallback preserved during rollout.
6. **System settings** (fees, limits, currencies/FX, feature flags, maintenance)
   editable without a deploy.
7. **Finance console**: deposits/withdrawals operable; ledger reconciles; exports
   work.
8. **Everything audited**; audit/security console searchable and exportable.
9. Tests green (guards, capabilities, critical DB flows); `tsc` clean; build
   passes — consistent with existing module gates.

---

## 10.5. Implementation status & Superadmin invariants

> Living log of what is actually built, updated as each phase lands.

### Phase A — Foundation ✅ (shipped)

Delivered on branch `module-11-admin-foundation`:

- **Role enum extended** (`supabase/migrations/008_admin_roles_enum.sql`):
  adds `creator`, `marketer`, `support`, `finance`, `superadmin`. Kept in a
  standalone migration because Postgres cannot use a newly added enum value in
  the same transaction that added it.
- **RBAC core** (`supabase/migrations/009_admin_rbac.sql`):
  - `role_permissions(role, capability)` table + seeded capability matrix
    (§2.2).
  - `has_capability(cap)` — the single capability source of truth; **superadmin
    short-circuits to TRUE for every capability** (god-mode).
  - `is_staff()`, `is_superadmin()`, `staff_roles()`; `is_admin()` now also
    recognises `superadmin`.
  - Staff-wide read RLS on `transactions`, `deposits`, `withdrawals`,
    `wallets`, and an `audit:read`-gated policy on `audit_log`.
- **Superadmin invariants — enforced by DB triggers** (not just app code, so
  they hold against the service-role key and direct SQL):
  1. *God-like:* implicitly holds every capability.
  2. *Cannot be demoted:* `guard_profile_role_change` blocks any change of a
     superadmin's role away from `superadmin`.
  3. *Cannot be removed:* `guard_profile_delete` blocks deleting a superadmin
     row; the same update guard blocks suspending/closing a superadmin.
  4. *Grant control:* assigning/revoking any staff role (incl. `superadmin`)
     from a real user session (`auth.uid()` present) requires the actor to be a
     superadmin.
  5. *Break-glass:* a session may `SET LOCAL app.superadmin_override = 'on'`
     (direct DB access only) to bypass invariants for disaster recovery — treat
     every use as a security event.
- **App layer**:
  - `lib/admin/rbac.ts` — pure, tested mirror of the DB matrix +
    `canGrantRole` / `canChangeUserRole` / `canChangeAccountStatus` guardrails
    (incl. superadmin immutability).
  - `lib/auth.ts` — `requireCapability(cap)`, `requireAdminPortal()`,
    `hasCapability(ctx, cap)`, `requireStaffRoleGrant(...)`.
  - `lib/admin/audit.ts` — `writeAudit()`, `requestContext()`, `redact()`.
  - `lib/admin/nav.ts` + `components/admin/AdminNav.tsx` — capability-filtered
    navigation; `middleware.ts` widened to `ADMIN_PORTAL_ROLES`
    (staff + `resolver`).
  - Admin shell (`app/admin/layout.tsx`), capability-aware overview
    (`app/admin/page.tsx`), and **guarded stub pages for every nav route**
    (no dead links) pending their phase.
- **Gates**: `rbac.test.ts` (23) + `admin-nav.test.ts` (8) green; full suite
  185/185; `tsc` clean; `next build` passes.

### Bootstrapping the first superadmin

Because staff-role grants from a user session are superadmin-only, the very
first superadmin must be created out-of-band via the service role / SQL console
(where `auth.uid()` is NULL, so the grant guard is intentionally skipped while
the immutability guards still hold):

```sql
-- Run once, after the owner has signed up via normal auth.
UPDATE public.profiles
SET role = 'superadmin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'owner@kichiko.co.ke');
```

Thereafter, that superadmin can grant every other staff role from the UI, and
can never be demoted or removed through the application.

### Phase B — Users & KYC ✅ (shipped)

Delivered on branch `module-11-admin-users-kyc` (stacked on Phase A):

- **Migration `010_admin_users.sql`**:
  - `admin_user_notes` (operator-only internal notes) + RLS.
  - `impersonation_sessions` (time-boxed, audited) + RLS.
  - Atomic, capability-checked **SECURITY DEFINER RPCs** (column-level control
    RLS can't express, each writes `audit_log`):
    `admin_set_account_status`, `admin_set_user_role` (full grant guardrails +
    superadmin immutability), `admin_adjust_balance` (atomic wallet delta →
    `transactions` + notification, FX to USD), `admin_add_user_note`.
  - Capability-based read policies so non-admin KYC reviewers (`support`) can
    read `kyc_documents` + storage objects. KYC review reuses the existing
    `admin_review_kyc` RPC.
- **App**:
  - `lib/admin/users.ts` (pure param parsing + filter builder + fetch) and
    `lib/admin/csv.ts` (RFC-4180 export) — both unit-tested.
  - `/admin/users` — server-rendered search / role / status / KYC / country
    filters, sort, pagination, CSV export.
  - `/admin/users/[id]` — profile, wallets, transactions, KYC docs, effective
    capabilities, internal notes, and server-authoritative action controls.
  - `/admin/kyc` — review queue (approve/reject with reason).
  - API: `users/[id]/{role,status,adjust-balance,note,impersonate}`,
    `users/export`, `kyc/[id]/review` — each `requireCapability`-guarded.
  - Actions computed server-side per operator (`canGrantRole`,
    `canChangeAccountStatus`, impersonation guardrails); a superadmin target is
    rendered immutable with all actions disabled.
- **Gates**: `admin-users.test.ts` (+10) green; full suite **195/195**; `tsc`
  clean; `next build` passes.

### Phase C — Markets & Finance ✅ (shipped)

Delivered on branch `module-11-admin-markets-finance` (stacked on Phase B):

- **Migration `011_admin_markets_finance.sql`**:
  - Capability-gated `SELECT` policy on `markets` so reviewers/resolvers see
    non-public (draft/pending/closed/disputed) markets from their own session
    (tracks `markets:approve|resolve|cancel`); reads reuse the migration-009
    staff-read policies on `deposits`/`withdrawals`/`transactions` + publicly
    viewable `profiles`.
  - Atomic, capability-checked, audited **SECURITY DEFINER RPCs** wrapping the
    existing money/lifecycle primitives (each writes `audit_log` with
    before/after + reason):
    - Markets: `admin_approve_market`, `admin_reject_market`,
      `admin_close_market`, `admin_dispute_market`, `admin_set_market_featured`,
      `admin_resolve_market` (wraps atomic `resolve_market` → payouts),
      `admin_cancel_market` (wraps atomic `cancel_market` → refunds).
    - Finance: `admin_approve_withdrawal` (clear review hold),
      `admin_reject_withdrawal` (atomic refund via `fail_withdrawal`),
      `admin_complete_withdrawal` (manual reconcile via `complete_withdrawal`),
      `admin_retry_withdrawal` (re-reserve funds + back to `processing`,
      balance-checked), `admin_fail_deposit` (cancel stuck deposit, no money
      moves). Every RPC self-checks `has_capability()` — defence in depth over
      the route/page guards.
- **App**:
  - `lib/admin/markets.ts` (pure param parsing + filter builder + fetch +
    `availableMarketActions` state→capability map) and `lib/admin/finance.ts`
    (deposits/withdrawals/ledger param parsing + fetch + pure `summariseLedger`
    reconciliation) — both unit-tested.
  - `/admin/markets` review queue (search/status/category/sort/paginate),
    `/admin/markets/[id]` detail with capability-gated lifecycle actions
    (approve/reject/close/dispute/resolve/cancel/feature),
    `/admin/markets/disputes` SLA-aged dispute queue.
  - `/admin/finance` overview (in-flight/failed/review KPIs),
    `/admin/finance/deposits` console (inspect + cancel stuck),
    `/admin/finance/withdrawals` console (approve/reject/retry/complete),
    `/admin/finance/ledger` unified transactions + reconciliation summary +
    CSV export.
  - API: `markets/[id]/action`, `finance/withdrawals/[id]/action`,
    `finance/deposits/[id]/action`, `finance/ledger/export` — each
    `requireCapability`-guarded and calling the audited RPCs via the operator
    session.
  - Client action panels (`MarketActions`, `WithdrawalActions`,
    `DepositActions`) with reason-required destructive flows + status pills.
- **Gates**: `admin-markets-finance.test.ts` (+16) green; full suite
  **211/211**; `tsc` clean; lint clean; `next build` passes.

### Phase D — Gateways & Settings ⭐ ✅ (shipped)

Delivered on branch `module-11-admin-gateways-settings` (stacked on Phase C).
Closes the headline gap: payment gateway credentials were env-only (a redeploy
per paybill/key change). They are now DB-backed, encrypted, and editable from
the UI with zero redeploys, plus a typed settings store and FX management.

- **Migration `012_admin_gateways_settings.sql`**:
  - `payment_gateways` (non-secret per-provider/country/env config + `secret_ref`
    metadata), `gateway_secrets` (pgcrypto-encrypted values; RLS-enabled with
    **no select policy** — only the service role / superadmin RPC can decrypt),
    `gateway_health` (connection-test log), `platform_settings` (typed key/value
    with an `is_public` flag so the app can read flags/limits/maintenance).
  - `_gateway_enc_key()` reads the `app.gateway_encryption_key` GUC (env-provided
    master key; dev fallback) — the key stays off the table/dump surface (§7.3).
  - Capability-checked, audited **SECURITY DEFINER RPCs**: `admin_upsert_gateway`,
    `admin_set_gateway_enabled`, `admin_delete_gateway` (`gateways:write`);
    `admin_rotate_gateway_secret`, `admin_clear_gateway_secret`,
    `admin_get_gateway_secret` (superadmin `gateways:secrets` / service role;
    secret VALUES never logged — only key + last4); `admin_record_gateway_health`
    (`gateways:read`); `admin_upsert_setting`, `admin_upsert_exchange_rate`
    (`settings:write`). RLS: gateways/health readable by `gateways:read`;
    settings readable when public or `settings:write`. Seeds default settings.
- **App**:
  - `lib/admin/gateways.ts` — pure provider field schema (non-secret vs secret),
    masking / `secret_ref` metadata readers, list-param parsing, fetch helpers,
    and the **DB-first `getGatewayConfig()` resolver with per-field env fallback**
    (rollout-safe). `lib/admin/settings.ts` — typed settings schema, coercion,
    merge-with-defaults, grouping. `lib/admin/gateway-test.ts` — sandbox-safe
    per-provider live auth/token connection test.
  - `/admin/settings/gateways` directory (health + enable/test/delete),
    `/admin/settings/gateways/new`, `/admin/settings/gateways/[id]` (non-secret
    config form, **write-only encrypted secret rotation**, health history),
    `/admin/settings` (grouped fees/limits/flags/maintenance/branding),
    `/admin/settings/currencies` (enable currencies + FX rate editor).
  - API: `gateways` (upsert), `gateways/[id]/action` (enable/disable/delete),
    `gateways/[id]/test` (resolves secrets via the service role, records health,
    never returns secrets), `gateways/[id]/rotate-secret` (superadmin),
    `settings` (bulk typed upsert), `settings/currencies` — each
    `requireCapability`-guarded and calling the audited RPCs.
  - **Payment lib wiring**: `lib/payments/mpesa.ts` refactored from module-level
    `process.env` constants to the call-time `getGatewayConfig` resolver
    (DB-first, env fallback preserved) as the reference; mtn/airtel/pesapal
    follow the identical pattern.
- **Gates**: `admin-gateways.test.ts` (+11) and `admin-settings.test.ts` (+9)
  green; full suite **231/231**; `tsc` clean; lint clean; `next build` passes
  (all new routes compiled).

### Phase E — Creators & Marketers ⭐ ✅ (shipped)

Delivered on branch `module-11-admin-creators-marketers` (stacked on Phase D).
Turns the creator/marketer/payout stub pages into full, capability-guarded
control planes: creator consoles & tiers, marketer consoles, commission plans,
promo campaigns, and the payout-run engine (§4.3, §4.4, §6.4).

**Key design decision (money-flow honesty).** Creator rewards are *already*
credited to the creator's USD wallet the instant a bet is placed (migration 004
`place_bet` + `creator_reward` transactions). Re-paying them in a payout run
would double-pay. So **creator payout runs are statements** (`settlement =
'statement_only'`): compute aggregates the already-credited rewards in the
period; disburse only reconciles them. **Marketer commissions genuinely accrue**
(nothing credited at signup/bet time): compute derives an amount from the
marketer's plan + attribution; disburse credits the marketer's USD wallet and
writes a `referral_bonus` transaction (`settlement = 'credited'`). We reuse the
existing `creator_reward` / `referral_bonus` transaction types rather than
`ALTER TYPE`, keeping money-flow reporting consistent.

- **Migration `013_admin_creators_marketers.sql`** — 9 tables: `creator_tiers`,
  `creator_profiles`, `commission_plans`, `marketer_profiles`,
  `role_applications`, `campaigns`, `campaign_redemptions`, `payout_runs`,
  `payout_items`. RLS: SELECT via `has_capability()` + self-read for own
  profile/items (no write policies — writes are RPC/service-role only, plus a
  narrow self-apply INSERT on `role_applications`). A run-total recompute trigger
  and the `IMMUTABLE marketer_commission_usd()` helper (mirrored in TS). **21
  SECURITY DEFINER RPCs** (capability-gated + audited): creator approve/update/
  set-status + tier upsert; marketer approve/update-plan/set-status/regen-code +
  commission-plan upsert; application reject (capability by kind); campaign
  upsert + set-status; and the **payout state machine** `admin_create_payout_run`
  → `admin_compute_payout_run` → `admin_approve_payout_run` →
  `admin_disburse_payout_run`, plus `admin_cancel_payout_run` and
  `admin_clawback_payout_item`. Seeds default tiers + commission plans.
- **App**:
  - `lib/admin/marketers.ts` (commission math mirroring the SQL, plan
    normalisation, attribution fetch), `lib/admin/payouts.ts` (run state machine,
    hold-gate eligibility, run summaries, default period), `lib/admin/creators.ts`
    (effective reward/limit resolution, stats), `lib/admin/campaigns.ts`
    (eligibility engine + value/budget math). **+49 unit tests**.
  - `/admin/creators` (directory + applications + tiers) & `/admin/creators/[id]`
    (stats + tier/privilege editor); `/admin/marketers` (directory +
    applications) & `/admin/marketers/[id]` (**live commission preview** +
    plan editor + code regen); `/admin/marketers/campaigns` (management + plan
    catalog); `/admin/marketers/payouts` (runs list + create) &
    `/admin/marketers/payouts/[id]` (item ledger + state-machine actions +
    per-item clawback).
  - API: 13 capability-gated handlers (creator/marketer/application lifecycle,
    tiers, commission plans, campaigns, payout create/action/clawback, and
    creator/marketer directory + payout statement CSV exports) — each
    `requireCapability`-guarded and calling the audited RPCs.
- **Gates**: `admin-marketers.test.ts`, `admin-payouts.test.ts`,
  `admin-creators-campaigns.test.ts` green; full suite **280/280**; `tsc` clean;
  lint clean (no new warnings); `next build` passes (all Module E routes compiled,
  35/35 pages).

### Phase F — pending

Stub pages exist and are capability-guarded; each will be replaced with full
functionality per §8. Remaining: Moderation / Announcements / Audit.

---

## 10. Related docs

- `01-ARCHITECTURE.md` — topology, stack, trust boundaries, secrets.
- `03-ROADMAP.md` — Module 11 (Admin) sequencing; this doc is its detailed spec.
- `04-FLOWS.md` — market lifecycle & payment flows the admin console operates on.
- `06-MARKETS.md` — market states/RPCs (`resolve_market`, `cancel_market`).
- `07-TRADING.md` — orders/positions and fee/reward economics.
