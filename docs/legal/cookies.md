# Cookie Disclosure

> **Launch template — pending legal review.** What cookies/local storage
> Kichiko uses and how to control them.

_Last updated: July 2026_

## Categories

| Category | Examples | Purpose | Can disable? |
| --- | --- | --- | --- |
| **Strictly necessary** | Supabase session/auth, CSRF/security | Sign-in, security, core function | No (breaks the app) |
| **Preferences** | `NEXT_LOCALE` (language) | Remember your language choice | Yes |
| **Performance/analytics** | web-vitals RUM (sampled) | Measure and improve speed | Yes |

We do **not** use third-party advertising/tracking cookies.

## The `NEXT_LOCALE` cookie
Stores your chosen interface language (`en`/`sw`/`fr`/`am`). It is `SameSite=Lax`,
long-lived, and **not** `httpOnly` (it only selects a display language — no
security value). Signed-in users' choice is also saved to their profile. See
`docs/i18n/TRANSLATION.md`.

## Managing cookies
Control or clear cookies via your browser settings. Disabling strictly necessary
cookies will prevent sign-in and core features from working. Disabling
preferences/analytics cookies is safe (you may lose your saved language and we
collect less performance data).

## Changes
We update this disclosure as our cookie usage changes. See
[privacy.md](./privacy.md) for the broader data policy.
