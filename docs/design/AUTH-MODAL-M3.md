# Milestone 3 — In-context Auth Dialog (deferred, no-navigation authentication)

Status: implemented · Owner: growth/frontend · Surfaces: market detail → order ticket gate

## 1. Problem & context

Continues the guest-journey conversion work (see M1: durable pending-bet). Previously,
the moment a logged-out guest tapped **Log in to trade** the app performed a full-page
navigation to `/auth/login`, unmounting the order ticket and the entire market context
(chart, order book, the stake they just typed). Every hop of a full-page auth flow is a
drop-off point, and the market momentum — the exact reason they were about to trade — was
thrown away.

Goal: authenticate **without leaving the market**, so the ticket never unmounts and the
guest returns to the exact moment they left — in the fewest possible steps.

## 2. Research (why in-context auth wins)

- **Polymarket / Kalshi / Robinhood** gate the *final* action, not browsing, and do it in a
  modal/slide-over layered over the current screen. The order context stays visible behind
  the scrim, which (a) preserves intent, (b) reassures the user nothing was lost, and
  (c) removes a page transition. We adopt the pattern, not the pixels.
- **Stripe Checkout / Apple** — calm, single-column forms; explicit "Show password" text
  over mystery eye glyphs; progressive disclosure of optional fields (referral). We keep
  our existing `PasswordInput` (text toggle) and referral disclosure.
- **Conversion research** — a contextual reason line at the point of gating lifts
  completion. We render the actual intent: *"Sign in to place KSh 500 on Yes."*

We deliberately did **not** copy competitor chrome; the dialog is 1:1 with the existing
Kichiko design language (AuthShell tokens, `tab-pill`, custom icons).

## 3. Architecture decisions

| Decision | Rationale |
|---|---|
| Single `AuthDialog` mounted once in `Providers` | Always available on every route without prop-drilling; mirrors the existing global deposit sheet. |
| Opened via `window` CustomEvent `kichiko:open-auth` (helper `openAuthDialog`) | Same decoupled idiom the app already uses (`kichiko:open-deposit`, `:select-option`). Any surface can summon it. |
| No navigation on the password path | `useAuth` subscribes to `onAuthStateChange`, so a successful in-modal sign-in reactively re-enables every ticket on the page. The guest's bet is still in React state — nothing to restore. |
| Pending-bet still persisted before opening | The **only** path that leaves the page is email confirmation. localStorage + the `?pb=` URL token (M1) rebuild the ticket on return, even cross-device. |
| Shared pure logic in `lib/auth-form.ts` | One source of truth for validation, password strength, country→currency, and error normalization — consumed by the dialog **and** the `/auth` pages (no duplicated logic). |
| Full-page `/auth/*` routes retained | Fallback for deep links, the email callback, and progressive enhancement. |

## 4. Information architecture & flow

```
Guest builds ticket (side · option · amount)
        │  taps "Log in to trade"
        ▼
goToAuth('login')  ── persists pending bet (localStorage + ?pb= in next) ──┐
        │  openAuthDialog({ mode, next, reason })                          │
        ▼                                                                  │
┌───────────────────────────── AuthDialog ─────────────────────────────┐  │
│  [logo]                                             [✕]                │  │
│  Welcome back / Create your account                                   │  │
│  «Sign in to place KSh 500 on Yes»            ← contextual reason     │  │
│  ( Sign in | Create account )                 ← tab-pill toggle       │  │
│  email · password (+ name · country · referral for register)         │  │
│  [ Sign in → ] / [ Create free account → ]                           │  │
│  🛡 Bank-grade encryption · Your data is never sold                   │  │
└───────────────────────────────────────────────────────────────────────┘ │
        │ password success                     │ register needs confirm     │
        ▼                                       ▼                            │
onAuthStateChange → ticket re-enables      "Check your email" state ─────────┘
(dialog closes; bet intact; 1 tap: Trade)  (link → /auth/callback?next → pb rebuild)
```

## 5. States

- **login** / **register** (toggle) — register adds name, country (→currency), password
  strength meter, progressive referral.
- **loading** — spinner + disabled submit; fields remain readable.
- **error** — `role="alert"` calm copy via `normalizeAuthError` (never raw provider text,
  enumeration-safe).
- **emailSent** — success panel ("Check your email … your prediction is saved and waiting").
- **submit gating** — disabled until `canSubmitLogin` / `canSubmitRegister` pass.

## 6. Design-system mapping (no new primitives)

Tokens/classes reused verbatim: `--surface`, `bg-surface-2`, `border-hairline`,
`text-text-*`, `bg-pip-100/500`, `text-pip-text`, `bg-yes/no/amber`, `.btn .btn-primary
.btn-lg .btn-secondary .btn-icon-sm`, `.input`, `.tab-pill`, `rounded-pill`, `font-display`,
`shadow-[var(--e3)]`, and `animate-fade-in` (scrim) / `animate-scale-in` (desktop) /
`animate-slide-up` (mobile sheet). Icons are the existing custom set (`LogoMark`,
`IconShield`, `IconArrowRight`, `IconCheck`, `IconX`). Password field reuses `PasswordInput`.

## 7. Accessibility (WCAG AA+)

- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` (title), `aria-describedby`
  (reason when present).
- Initial focus → first field (email for login, name for register); focus **restored** to
  the trigger on close.
- **Focus trap** cycles Tab/Shift+Tab within the dialog.
- **Esc** closes; scrim click closes; body scroll locked while open.
- Tab toggle uses `role="tablist"/"tab"` + `aria-selected`; error is `aria-live="assertive"`;
  strength meter is `aria-describedby` on the password input; decorative bars `aria-hidden`.
- Verified in both `light` and `dark` schemes.

## 8. Responsive

- **≥ lg**: centered card (`max-w-md`), `animate-scale-in`, positioned above the scrim
  (`lg:relative lg:z-10`).
- **< lg**: full-width bottom sheet with grab handle, `animate-slide-up`, safe-area padding
  (`env(safe-area-inset-bottom)`), `max-h-[88vh]` scroll.

## 9. Real-world scenario matrix (QA)

| # | Scenario | Expected | Coverage |
|---|---|---|---|
| 1 | Guest taps "Log in to trade" | Dialog opens over market; ticket intact | e2e `wiring` (desktop, live build+DB) |
| 2 | Opens with dialog semantics + focus | role/aria-modal/labelled; focus in dialog | e2e contract (desktop+mobile) |
| 3 | Login submit gating | disabled until valid email+password | e2e + unit `canSubmitLogin` |
| 4 | Switch to Create account | name+country appear; gated on 8-char pw | e2e + unit `canSubmitRegister` |
| 5 | Password strength meter | shows on typing; "Strong" for strong pw | e2e + unit `scorePassword` |
| 6 | Esc closes + restores scroll | dialog hidden; body overflow restored | e2e |
| 7 | Scrim click dismisses | dialog hidden | e2e |
| 8 | Rapid double-open | exactly one dialog (idempotent) | e2e |
| 9 | Password login success | onAuthStateChange re-enables ticket; no nav | manual + architecture (reactive useAuth) |
| 10 | Register, confirmation ON | "Check your email"; `next` threaded to callback | code path + M1 pending-bet |
| 11 | Register, confirmation OFF | live session; dialog closes; ticket re-enables | code path |
| 12 | Return via email (same/cross device) | ticket rebuilt from localStorage/`?pb=` token | M1 carriers + `decodePendingBetParam` |
| 13 | Currency differs at signup | stake converted through USD on restore | M1 currency-correct restore |
| 14 | Error (bad creds / rate limit / network) | calm, non-leaky copy | unit `normalizeAuthError` |
| 15 | Underfunded new user after auth | inline "Add funds" / deposit prompt (existing) | existing ticket path |
| 16 | Dark & light schemes | fully themed | screenshot review |

Automated: **21 unit tests** (`auth-form`) + **15 e2e** (`auth-modal`, chromium+mobile).
Local gates: `tsc --noEmit` clean · `next lint` clean · full unit suite green · prod build green.

## 10. Follow-ups (not in this milestone)

- Passwordless magic-link / OTP option (kills the password field entirely for new users).
- Auto-advance: after auth, if funded, one-tap place; else route straight to one-tap deposit
  for the exact stake.
- Progressive migration of navbar "Sign in" links to `openAuthDialog` where a modal is
  preferable to navigation.
