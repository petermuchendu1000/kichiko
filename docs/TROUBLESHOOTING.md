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

Windows PowerShell (if you prefer manual):

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
