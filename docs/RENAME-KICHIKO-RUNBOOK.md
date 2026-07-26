# Kichiko rename runbook (MarketPips → Kichiko)

Status of the rename and the **external / account-level steps that must be done
by a human** (they cannot be changed from the repo). The in-repo rename (app
code, config, infra code, DB objects, docs, brand assets) is **complete and
merged**; this runbook covers everything outside the codebase.

## ✅ Done in the repo (merged to `main`)
- **App/UI/PWA/emails/SMS/i18n** brand strings → `Kichiko` (PR #72).
- **Domains** in code → `kichiko.co.ke` / `kichiko.app` defaults (PR #72).
- **Package names** `kichiko` / `kichiko-web`; `supabase/config.toml`
  `project_id=kichiko`; `package-lock.json` synced (PR #72).
- **Fly apps** `kichiko-staging` / `kichiko-prod`; deploy/rollback/release
  workflows; **Terraform** org/workspace/resource labels + `KICHIKO_DOMAIN`
  var (PR #72).
- **Brand assets** regenerated: `og-image.png`, `icon-192/512.png`, emerald
  `favicon.svg` (PR #72).
- **DB objects** (PR #73, migration 055, applied live): `schedule_kichiko_jobs`,
  `schedule_kichiko_btc_jobs`, cron job names `kichiko-*`; legacy
  `marketpips-*` functions dropped and jobs unscheduled.
- **Docs** swept (PR #74).
- Historical `supabase/migrations/001–052` are intentionally **unchanged**
  (append-only migration history); the live objects they created were renamed by
  055. Do NOT rewrite applied migrations.

## ⚠️ External steps (human-only) — checklist

### 1. Domain, DNS & TLS  (highest lead time)
- [ ] Register **`kichiko.co.ke`** (+ `app.`, `staging.`, `www.` as used).
- [ ] Create the Cloudflare zone; point DNS at Fly (or host); issue TLS certs.
- [ ] Set the GitHub secret **`NEXT_PUBLIC_APP_URL`** = `https://kichiko.co.ke`
      (or the chosen apex) so the app build emits correct links/CORS.

### 2. Terraform Cloud + Cloudflare (avoid a destroy/recreate!)
- [ ] Rename (or create) the **TFC organization** `marketpips`→`kichiko` and
      **workspace** `marketpips-infra`→`kichiko-infra` to match `backend.tf`
      (or edit `backend.tf` to your real org/workspace).
- [ ] Rename the GitHub secret **`MARKETPIPS_DOMAIN`** → **`KICHIKO_DOMAIN`**
      (the Terraform workflow now reads `KICHIKO_DOMAIN`).
- [ ] Because resource **labels** changed (e.g.
      `cloudflare_zone_settings_override.marketpips` → `.kichiko`,
      `cloudflare_tiered_cache.marketpips` → `.kichiko`), run
      `terraform state mv` for each so Terraform **renames in state** instead of
      destroying + recreating:
      ```
      terraform state mv cloudflare_zone_settings_override.marketpips \
                         cloudflare_zone_settings_override.kichiko
      terraform state mv cloudflare_tiered_cache.marketpips \
                         cloudflare_tiered_cache.kichiko
      ```
      Then `terraform plan` should show **no changes** (or only the domain value).

### 3. Fly.io hosting
- [ ] `fly apps create kichiko-staging` and `kichiko-prod`; set their secrets.
- [ ] Add the **`FLY_API_TOKEN`** GitHub secret to enable CI build/deploy/smoke
      (currently skipped — see Deploy Staging logs).
- [ ] Deploy, verify health, cut DNS over, then retire the old `marketpips-*`
      Fly apps.

### 4. Supabase Auth (login breaks if skipped)
- [ ] Auth → URL Configuration: set **Site URL** and **Redirect URLs** to the new
      domain (`https://kichiko.co.ke/**`, staging, localhost).
- [ ] Re-upload the renamed **email templates** (`supabase/templates/*.html`) in
      Auth → Email Templates (they now say “Kichiko”).
- [ ] Rename the **project display name** to “Kichiko” (Settings → General).
      Cosmetic only — ref `uzkphkvzoeypcljntlih`, URL, and keys are unchanged.

### 5. Email deliverability (Resend)
- [ ] Verify the new sending domain `kichiko.co.ke` in Resend; add **SPF/DKIM/
      DMARC** DNS records.
- [ ] Set **`RESEND_FROM_EMAIL`** = `Kichiko <noreply@kichiko.co.ke>`.

### 6. SMS sender ID (Africa's Talking — approval lead time)
- [ ] Register the alphanumeric sender ID **“Kichiko”** with Africa's Talking /
      the telcos (can take days for approval).
- [ ] Set **`AFRICASTALKING_SENDER_ID`** = `Kichiko`.

### 7. GitHub repository (optional)
- [ ] Rename `petermuchendu1000/marketpips` → `.../kichiko` (GitHub 301-redirects
      old URLs). Update local remotes: `git remote set-url origin <new>`.
      CI workflows don't hardcode the repo name, so nothing else changes.

### 8. Post-cutover hygiene
- [ ] Re-scrape the OG image on social platforms (they cache `og-image.png`).
- [ ] Bump the service-worker cache version so returning PWA users refresh.
- [ ] Rename the project in error tracking / analytics (Sentry, etc.);
      update DSNs if the slug changes.
- [ ] Update the business/display name shown at payment checkout (M-Pesa /
      gateway), if it surfaces the brand.

## Verification
`grep -rIn "marketpips" . --exclude-dir=node_modules --exclude-dir=.next` returns
matches **only** under `supabase/migrations/` (historical, expected).
