# Kichiko — Translation & Localization Workflow

> Module 17.3 / 17.4. How UI copy is internationalized, how to add or complete a
> language, and the guardrails (missing-key check, pseudo-locale, RTL-readiness)
> that keep localization from regressing.

## 1. Architecture at a glance

- **Framework:** [`next-intl`](https://next-intl.dev) in **no-routing mode** — the
  active locale comes from the `NEXT_LOCALE` cookie (mirrored from
  `profiles.preferred_locale` for signed-in users), **not** a URL segment. This
  deliberately avoids an `app/[locale]/…` restructure of a large, live app.
- **Source of truth:** `apps/web/messages/en.json`. English is always complete;
  every other catalog is a subset that falls back to English at runtime
  (`i18n/request.ts` → `loadMessages`), so a partial locale never crashes a page.
- **Locale registry:** `apps/web/i18n/config.ts` — `LOCALES`, `LOCALE_LABELS`,
  `LOCALE_TIMEZONE`, `DEFAULT_LOCALE`, `LOCALE_COOKIE`. Adding a language is a
  one-line change here plus a catalog file (and one line in migration 018's
  CHECK if you want it persistable).
- **Formatting:** never hand-roll. Dates/times/numbers/percentages go through
  `apps/web/lib/format.ts`; money goes through `lib/currency.ts`
  (`formatCurrency` + `CURRENCY_META`). Both are locale + `Africa/*` timezone
  aware and unit-tested.

Currently shipped: `en` (complete), `sw` (Kiswahili — high-value stub: auth,
wallet, betting, errors). Scaffolded for `fr` (Burundi/Rwanda) and `am`
(Ethiopia).

## 2. Using strings in code

Server component:

```tsx
import { getTranslations } from 'next-intl/server'
const t = await getTranslations('wallet')
return <h1>{t('title')}</h1>
```

Client component:

```tsx
'use client'
import { useTranslations } from 'next-intl'
const t = useTranslations('betting')
return <button>{t('placeBet')}</button>
```

Rules:
- **No hard-coded user-facing English in JSX.** Every visible string is a catalog
  key. (The pseudo-locale below exists to catch violations.)
- Use **ICU MessageFormat** for interpolation/plurals — never string
  concatenation: `"{count, plural, =0 {No bets} one {# bet} other {# bets}}"`.
- Keys are **namespaced** by feature (`common`, `nav`, `home`, `wallet`,
  `betting`, `errors`). Add new namespaces sparingly and keep them stable —
  renaming a key is a breaking change for every catalog.

## 3. Adding or completing a language

1. Add the locale to `LOCALES` (and a friendly name in `LOCALE_LABELS`, a
   timezone in `LOCALE_TIMEZONE`) in `i18n/config.ts`.
2. If users should be able to persist it, add it to the CHECK constraint in
   `supabase/migrations/018_preferred_locale.sql` (new migration if 018 is
   already applied in an environment).
3. Copy `messages/en.json` → `messages/<locale>.json` and translate values.
   Keep the **key structure identical**; translate values only.
4. Run the guards:
   ```bash
   npm run i18n:check        # no orphan/typo keys; reports % translated
   npm run i18n:pseudo:check # pseudo-locale in sync (if you touched en.json)
   ```
5. Missing keys are allowed pre-launch — they fall back to English. Aim for 100%
   on the money path (auth, wallet, deposit/withdraw, betting, errors) first.

## 4. Missing-key check (CI)

`scripts/check-i18n-keys.mjs` (`npm run i18n:check`) fails the build on
**structural** errors — orphan keys (a translation key that no longer exists in
`en`) or invalid JSON — and reports per-locale coverage informationally. It is
wired into CI so catalogs can't silently drift from the source.

## 5. Pseudo-locale (`en-XA`) — layout & extraction check

`scripts/gen-pseudo-locale.mjs` (`npm run i18n:pseudo`) generates
`messages/en-XA.json` from `en.json` by:

- **accenting** every letter (`Markets` → `Ṁáŕķéţš`) so any plain-English text
  still on screen is instantly visible as **un-extracted** (a hard-coded-string
  bug);
- **padding ~40%** longer to surface **truncation / overflow** in tight UI;
- **bracketing** each string with `⟦ … ⟧` to reveal **concatenation** bugs where
  fragments were glued in code instead of composed with ICU placeholders.

ICU placeholders (`{name}`, `{count, plural, …}`) and tags are preserved, so
interpolation keeps working. `en-XA` is a **dev/CI aid only** — it is
intentionally **not** in `LOCALES` and never ships to users. To view it locally,
temporarily add `en-XA` to `LOCALES` on a scratch branch and set the
`NEXT_LOCALE=en-XA` cookie. `npm run i18n:pseudo:check` fails CI if the committed
`en-XA.json` is stale relative to `en.json`.

## 6. Locale persistence & switching

- **Switcher:** `components/layout/locale-switcher.tsx` (native `<select>`,
  fully keyboard/AT-operable) in the footer. It POSTs to `/api/locale`.
- **`/api/locale`:** validates the locale against `LOCALES`, sets the
  `NEXT_LOCALE` cookie (SameSite=Lax, 1-year, not httpOnly — it only picks a
  display language), and for signed-in users writes `profiles.preferred_locale`
  (migration 018) so the choice is portable across devices. Cookie is
  authoritative for rendering; profile write is best-effort.
- On sign-in, mirror `preferred_locale` → `NEXT_LOCALE` so returning users keep
  their language (wire into the auth callback as locales roll out).

## 7. SEO

Because locale is cookie/profile-based (no per-locale URL), every language is
served from the **same canonical URL**. `app/layout.tsx` `metadata.alternates`
advertises the supported languages + `x-default` via `hreflang`, all mapped to
`/`. This is intentional and minimal: we are not doing per-locale routing, so we
do **not** duplicate URLs. If per-locale URLs are ever adopted, switch the
`languages` map to real localized paths and revisit `openGraph.locale`.

## 8. RTL-readiness

Current target locales (en, sw, fr, am) are all **LTR**, but we keep future
Arabic/Hebrew/etc. cheap by preferring **CSS logical properties** in new styles:

| Use (logical)                     | Instead of (physical)        |
| --------------------------------- | ---------------------------- |
| `margin-inline-start/-end`        | `margin-left/-right`         |
| `padding-inline-*`                | `padding-left/-right`        |
| `inset-inline-start/-end`         | `left` / `right`             |
| `text-align: start/end`           | `text-align: left/right`     |
| Tailwind `ps-*`/`pe-*`/`ms-*`/`me-*` | `pl-*`/`pr-*`/`ml-*`/`mr-*` |

When RTL is enabled, set `dir="rtl"` on `<html>` alongside `lang`, and logical
properties flip automatically — no per-component rewrites. Avoid encoding
direction in icons/arrows that imply reading order without a logical fallback.

## 9. Contributor checklist

- [ ] New UI copy added as catalog keys (no hard-coded English).
- [ ] Interpolation/plurals via ICU, not concatenation.
- [ ] `npm run i18n:check` green.
- [ ] `npm run i18n:pseudo` re-run and `en-XA.json` committed if `en.json`
      changed; `npm run i18n:pseudo:check` green.
- [ ] Dates/numbers/money via `lib/format.ts` / `lib/currency.ts`, not ad-hoc
      `toLocaleString()`.
- [ ] New CSS uses logical properties.
