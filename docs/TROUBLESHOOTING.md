# Troubleshooting (local development)

Fast fixes for the most common local-dev issues. Most runtime weirdness after a
`git pull`, a branch switch, or the MarketPips → Kichiko rename is a **stale
build cache**, not a code bug — CI builds `main` clean on every merge.

---

## 1. `TypeError: Cannot read properties of undefined (reading 'call')`

Typically thrown from a provider in `app/layout.tsx` (e.g. `<ThemeProvider>`),
but it can point at any component.

**Cause.** Next.js keeps an incremental Webpack cache in `apps/web/.next`. After
a rename, a `git pull` that changes modules, or a branch switch, cached chunks
reference module IDs that no longer match. Webpack then calls
`modules[id].call(...)` where `modules[id]` is `undefined` → this error. The code
is fine (production `next build` and `next dev` both pass on a clean checkout).

**Fix — clear the cache and reinstall, then restart:**

```bash
# from the repo root
npm run clean       # removes apps/web/.next + node_modules/.cache (cross-platform)
npm install         # ensure deps (e.g. next-themes) are present after a pull
npm run dev
```

One-shot equivalent: `npm run dev:clean`.

### If it persists (or points at a *different* component each time)

`npm run clean` only clears `.next`. If the error survives it, appears on a new
component after a `git pull`, or showed up right after a **Next.js version bump**
or an **interrupted `npm install`**, then `node_modules` itself is corrupted —
classically a half-swapped SWC compiler. On Windows this is often signalled by:

```
npm warn cleanup Failed to remove ... @next\.swc-win32-x64-msvc ...
  [Error: EPERM: operation not permitted, unlink '...next-swc.win32-x64-msvc.node']
```

That EPERM means a running process (a dev server or your editor) **locked the
compiler binary**, so npm couldn't replace it — leaving a broken toolchain that
emits corrupt client chunks. Do a full, lock-free reinstall:

```powershell
# 1) close EVERYTHING holding the files (dev server + extra terminals)
taskkill /F /IM node.exe          # Windows  (macOS/Linux: pkill -f next)
# 2) nuke node_modules + .next and reinstall from the lockfile
npm run reinstall                 # removes node_modules + apps/web/.next, then npm install
# 3) start fresh
npm run dev
```

> Verified: a clean `next build` compiles every route (incl. the Recharts-backed
> `outcomes-chart` chunk) with 0 errors, and `next dev` renders the market page.
> So a `reading 'call'` error is a stale/corrupt local artifact, not a code bug.

Windows PowerShell (manual `.next`-only clean, when that's all you need):

```powershell
Remove-Item -Recurse -Force apps\web\.next
Remove-Item -Recurse -Force node_modules\.cache -ErrorAction SilentlyContinue
npm install
npm run dev
```

> Rule of thumb: **any** "works in CI but not locally" rendering error →
> `npm run clean` first.

---

## 2. "Am I on the right repo?" (MarketPips → Kichiko rename)

The GitHub repo was renamed `marketpips` → `kichiko`. GitHub **redirects** the
old URL, so an old `origin` still pulls the *correct* repo — but update it to
avoid confusion:

```bash
git remote -v                       # if it shows .../marketpips(.git)
git remote set-url origin https://github.com/petermuchendu1000/kichiko.git
git remote -v                       # verify -> .../kichiko.git
git checkout main
git pull origin main                # brings latest (blue logo, authz fixes, ...)
```

`Already up to date.` simply means your `main` already has every commit on the
remote — it is not an error.

---

## 3. Can't place an order (`permission denied for function clob_place_order`, 42501)

Order placement runs through the **service-role** Supabase client. If
`SUPABASE_SERVICE_ROLE_KEY` is missing or holds an anon/publishable key, the
admin client silently runs as `anon` and every privileged RPC returns 42501.
`createAdminClient()` now throws a descriptive error in this case instead of
failing deep in the stack.

**Fix.** In `apps/web/.env.local` set the **secret** key (new `sb_secret_...`
format or the legacy `service_role` JWT) — never the `sb_publishable_...` key:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...   # browser-safe
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...            # SERVER ONLY — never NEXT_PUBLIC_
```

Restart the dev server after editing env (Next.js only reads `.env.local` at
boot). If the whole app is also crashing (see §1), fix that first — a broken
root layout takes the trade panel down with it.

---

## 4. "Too many attempts. Please wait a moment and try again" (auth)

This is Supabase Auth rate-limiting repeated sign-up/sign-in attempts from the
same IP. It is transient — wait ~30–60s and retry. It does not indicate a code
fault. For heavy local testing, use distinct test emails and avoid rapid retries.

---

## 5. "Could not create your account. Please try again." (signup)

**Root cause (isolated 2026-07):** signup requires a confirmation email
(`mailer_autoconfirm=false`), and Supabase/GoTrue could not send it — it
returned `500 unexpected_failure "Error sending confirmation email"`. The DB
side is healthy (the `handle_new_user` trigger creates the profile + wallets;
an admin-API user create succeeds). The failure is purely **email delivery**:

- **Custom SMTP (Resend) sender was the stale pre-rebrand identity** —
  `smtp_admin_email=noreply@marketpips.co.ke`, `smtp_sender_name=MarketPips`,
  `site_url=https://marketpips.co.ke`. If that sender domain is no longer
  verified in Resend, or the SMTP key was rotated, every send fails.
- **`rate_limit_email_sent` was 2/hour** — a second attempt returned `429
  "email rate limit exceeded"` (which surfaces as "Too many attempts").

`normalizeAuthError` now maps email-send failures to a dedicated message
instead of the generic one, so this is diagnosable from the UI.

**Proper production fix (do this):**
1. In **Resend**, verify the sending domain you intend to use and mint a fresh
   SMTP/API key.
2. In **Supabase → Auth → SMTP settings**, set `smtp_admin_email`,
   `smtp_sender_name`, and the SMTP password to the verified Kichiko sender;
   set **Auth → URL Configuration → Site URL** to the current app domain so
   confirmation/reset links resolve.
3. Keep `rate_limit_email_sent` at a sane value (≥ ~30/hour).

**Interim unblock (already applied):** `mailer_autoconfirm=true`, so signups
succeed immediately without an email round-trip (verified end-to-end: signup →
session → profile + wallets → password login). ⚠️ Revert to `false` once SMTP is
healthy if you require verified emails before first login. Note OTP login and
password reset still depend on working email, so fixing SMTP is required
regardless.

