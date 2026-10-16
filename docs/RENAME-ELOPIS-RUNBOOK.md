# Elopis rename runbook (Kichiko → Elopis)

The in-repo rename is **done and merged**. This file covers what remains, which
is everything outside the codebase and cannot be changed from here.

**The name.** Elopis, said **eh-LOH-pis** — stress on the middle syllable. The
long *LOH* is what separates it audibly from "ellipsis", so it belongs in every
brand guideline, ad brief and voice recording. Written plainly as **Elopis**;
the display lockup is **E[lopis]**.

From ἐλπίς, *elpis* — ancient Greek for **expectation**: the forward-leaning
state of mind about an outcome not yet known. In Hesiod it is the one thing
left in Pandora's jar after everything else escaped. The coinage also carries
Latin *opis* (of resources, of means), which is the half that distinguishes
this product from a poll: here an expectation is only worth stating if
something is staked behind it.

---

## ✅ Done in the repo

- **App, UI, PWA, emails, SMS, i18n** brand strings → `Elopis` (247 files,
  817 replacements).
- **Domain defaults** → `elopis.com` everywhere. This also collapses a
  pre-existing split the footer used to apologise for in a comment: `/help`
  said `support@kichiko.app` while the database default said
  `support@kichiko.co.ke`. There is now **one** support address,
  `support@elopis.com`.
- **Package names** `elopis` / `elopis-web`; `supabase/config.toml`
  `project_id = "elopis"`; `package-lock.json` regenerated (the workspace
  symlink `node_modules/kichiko-web` is stale after this — run `npm install`
  once, or `next dev` fails with a Turbopack invariant error).
- **Fly apps** `elopis-staging` / `elopis-prod`; workflows; **Terraform**
  labels and `ELOPIS_DOMAIN`.
- **Brand assets** rebuilt from one vector: `logo-tile.svg`, `favicon.svg`,
  `icon-192/512.png`, `og-image.png`.
- **DB objects** (migration 111, applied): `schedule_elopis_jobs`,
  `schedule_elopis_btc_jobs`; the helpers now unschedule `elopis-*`,
  `kichiko-*` **and** `marketpips-*` before scheduling, so no two generations
  of cron jobs can fire the same endpoint on the same minute.
- Migrations `001–110` are untouched applied history, as in the last rename.

**Deliberately not renamed:** `docs/research/ui-2026-09/captures-v2/` (DOM
snapshots of the site as it was — measurement records, and rewriting them would
falsify what was measured), the two competitor 404-probe URLs recording real
requests to polymarket.com and demo.kalshi.co, and absolute sandbox paths.

---

## ⚠️ External steps — human only

### 1. Domains (do this first; everything else waits on it)
As of 2026-10-16 **every one of these was unregistered**, verified against the
registries rather than a reseller's search box:

- [ ] **`elopis.com`** — the primary. Also `.co`, `.io`, `.ai`, `.app`, `.net`,
      `.org`, `.market`, `.finance`, `.exchange`, `.africa`, `.ke`, `.co.ke`.
- [ ] Defensive: `ellopis.com`, `elopisapp.com`. (`elopsis.com` is a
      third-party typo-neighbour and is **not** available.)
- [ ] Cloudflare zone, DNS to Fly, TLS.
- [ ] GitHub secret `NEXT_PUBLIC_APP_URL` = `https://elopis.com`.

### 2. Handles
- [ ] `github.com/elopis`, X, Instagram, LinkedIn. The npm name `elopis` is
      free. (The sandbox proxy blocks github.com and x.com, so these two were
      **not** verified from here — check them yourself before announcing.)

### 3. Trademark
- [ ] File before launch, not after: **class 36** (financial services,
      exchanges), **class 9** (downloadable software), **class 42** (SaaS), and
      **class 41** if the Kenyan licence puts you in the gaming bracket.
- [ ] KIPI first, then EUIPO/USPTO or Madrid. An open-web search found no
      Elopis mark, company or app; the nearest filing is **ELPPIS** (2024, US,
      clothing) which is a different spelling in a different class. **That is
      not formal clearance** — a Kenyan IP attorney should search the register.

### 4. Terraform + Cloudflare (avoid a destroy/recreate)
- [ ] Rename the TFC organization and workspace to `elopis` / `elopis-infra`,
      or edit `backend.tf` to match what you really have.
- [ ] Rename the GitHub secret `KICHIKO_DOMAIN` → **`ELOPIS_DOMAIN`**.
- [ ] Resource **labels** changed, so `terraform state mv` each one rather than
      letting Terraform destroy and recreate:
      ```
      terraform state mv cloudflare_zone_settings_override.kichiko \
                         cloudflare_zone_settings_override.elopis
      terraform state mv cloudflare_tiered_cache.kichiko \
                         cloudflare_tiered_cache.elopis
      ```
      Then `terraform plan` should show no changes beyond the domain value.

### 5. Fly.io
- [ ] `fly apps create elopis-staging` and `elopis-prod`; set secrets; deploy;
      verify health; cut DNS; retire the `kichiko-*` apps.

### 6. Supabase Auth (login breaks if skipped)
- [ ] Auth → URL Configuration: Site URL and Redirect URLs →
      `https://elopis.com/**`, staging, localhost.
- [ ] Re-upload `supabase/templates/*.html` in Auth → Email Templates.
- [ ] Project display name → "Elopis" (cosmetic; ref, URL and keys unchanged).

### 7. Email and SMS
- [ ] Verify `elopis.com` in Resend; add SPF/DKIM/DMARC.
- [ ] `RESEND_FROM_EMAIL` = `Elopis <noreply@elopis.com>`.
- [ ] Register the alphanumeric sender ID **"Elopis"** with Africa's Talking —
      telco approval takes days, so start it early.

### 8. The cron helpers
- [ ] Per environment, re-run:
      `select public.schedule_elopis_jobs('https://elopis.com', '<CRON_SECRET>');`
      It unschedules the older generations itself. Nothing was scheduled in
      production when migration 111 ran, so nothing was lost.

### 9. Post-cutover
- [ ] Re-scrape the OG image (platforms cache `og-image.png`).
- [ ] Bump the service-worker cache version so PWA users refresh.
- [ ] Rename the project in error tracking/analytics; update DSNs if the slug
      changes.
- [ ] Update the business name shown at M-Pesa/gateway checkout.
- [ ] Rename the GitHub repo `kichiko` → `elopis` (GitHub 301-redirects; then
      `git remote set-url origin <new>`). CI does not hardcode the repo name.

---

## Verification

```
grep -rIn "[Kk]ichiko" . --exclude-dir=node_modules --exclude-dir=.next \
  --exclude-dir=captures-v2 | grep -v supabase/migrations
```
should return only: this file's title, `docs/RENAME-KICHIKO-RUNBOOK.md` (the
record of the *previous* rename), absolute sandbox paths in research logs, and
the two competitor probe URLs.
