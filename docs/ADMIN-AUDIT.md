# Admin Dashboard Audit

Systematic review of the admin control plane (`app/admin/*`, `app/api/admin/*`,
`components/admin/*`). Baseline: `tsc` clean, `next lint` clean, 686 unit tests
green. The dashboard is well-architected; findings below are prioritized
enhancements, not breakages. Severity: P1 (fix soon) / P2 (should) / P3 (nice).

_Last updated: 2026-07-25._

## Scope reviewed
- Shell: `layout.tsx` (RBAC gate + role badge), `AdminNav` (capability-filtered,
  responsive sidebar/drawer), shared UI kit (`components/admin/ui/*`).
- Sections: dashboard, users, markets (+disputes), finance (deposits,
  withdrawals, ledger), KYC, moderation, creators, marketers (+campaigns,
  payouts), staff, announcements, audit, settings (currencies, gateways).
- 38 admin API routes, capability checks via `has_capability` + RLS.

## Strengths (keep)
- Defence-in-depth authz: middleware -> `canAccessAdminPortal` in the layout ->
  RLS + `has_capability` in RPCs. Capability-filtered nav (`visibleNav`).
- Payment gateway secrets encrypted at rest (pgcrypto), write-only from UI,
  decrypted only server-side (service role). Verified E2E with live M-Pesa.
- Consistent design tokens + dark mode, bespoke icon set, responsive layout,
  pure/tested model helpers (`lib/admin/*`).

## Findings

### Fixed this pass
- **[P1, bug] Gateway secrets never decrypted on Supabase.**
  `admin_get_gateway_secret` / `admin_rotate_gateway_secret` are SECURITY DEFINER
  with `search_path=public`, but pgcrypto lives in the `extensions` schema, so
  `pgp_sym_decrypt`/`encrypt` were unresolvable — every secret read failed and
  the gateway connection test reported "Missing consumer_key / consumer_secret".
  Migration `036` recreates both with `search_path = public, extensions` (still a
  fixed path). Verified: M-Pesa health check now returns ✓ "OAuth token acquired".
- **[P2, a11y] Mobile nav drawer**: no Escape-to-close and it lingered after
  navigation. Added `Escape` handler + auto-close on route change in `AdminNav`.

### Open (prioritized)
- **[P1] `PAYMENTS_ENV` gate**: production gateways only resolve when
  `PAYMENTS_ENV=production`. Add a visible banner in the gateways console when an
  enabled `production` gateway exists but the running env is `sandbox`, so an
  operator isn't misled into thinking live payments are active.
- **[P1, security] Gateway encryption key**: `app.gateway_encryption_key` GUC
  can't be set on managed Postgres from SQL, so the migration fallback key is in
  effect. Surface a warning in the gateways console when the GUC is unset, and
  document the hardening path (see GO-LIVE-PROVISIONING.md).
- **[P2, i18n] Hardcoded locale**: dashboard/table timestamps use
  `toLocaleString('en-KE', ...)` while the app ships `next-intl`. Thread the
  active locale through so dates localize (UG/TZ/RW/ET differ).
- **[P2, observability] Silent counts**: `count()` on the dashboard swallows
  errors and returns 0, which can mask a real DB/RLS failure as "0". Log the
  failure to the error tracker while still degrading gracefully.
- **[P2, perf/scale] Table pagination**: large lists (users, ledger, audit)
  should confirm server-side pagination + indexed sort keys; add virtualization
  or cursor pagination for the audit log at volume.
- **[P3, UX] Gateway form**: `base_url` placeholder is the sandbox host; add an
  environment-aware default/helper and a "test connection" affordance next to
  save (a test route already exists at `/api/admin/gateways/[id]/test`).
- **[P3, UX] Bulk actions**: users/markets/moderation queues would benefit from
  multi-select bulk actions (approve/close) to speed triage.
- **[P3, a11y] Focus management**: action modals (adjust balance, rotate secret)
  should confirm focus trap + return-focus on close.

## Verifications performed
- M-Pesa production gateway inserted (KE/KES, enabled), secrets encrypted +
  round-trip decrypt OK, masked `secret_ref` renders in the console. Production
  Consumer Key/Secret validated against Safaricom OAuth (live token).
