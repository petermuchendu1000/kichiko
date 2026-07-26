# Accessibility Audit (WCAG 2.1 AA) — Kichiko (Module 17.2)

> Companion to `docs/a11y/BASELINE.md` (automated gates). This is the **manual**
> audit: methodology, per-journey checklist, code remediations shipped, and the
> sign-off record. Target: **WCAG 2.1 Level AA**.

## Methodology

Each key journey is verified against four manual passes plus the automated axe
gate (`e2e/a11y.spec.ts`):

1. **Keyboard-only** — unplug the mouse. Tab/Shift-Tab through everything;
   confirm logical focus order, visible focus ring, no traps, Esc closes
   dialogs, Enter/Space activate controls.
2. **Screen reader** — NVDA (Windows) and VoiceOver (macOS/iOS). Confirm every
   control has a name/role/value, images/icons have text alternatives, async
   updates are announced, and form errors are read and associated.
3. **Zoom & reflow** — 200% browser zoom and 320 px viewport: no content loss,
   no horizontal scrolling of the page, touch targets ≥ 44×44 px.
4. **Contrast** — text ≥ 4.5:1, large text / UI ≥ 3:1, in **both** light and
   dark themes; meaning never conveyed by color alone.

## Code remediations shipped (17.1 + 17.2)

| Success criterion | Fix | Location |
|---|---|---|
| 1.1.1 Non-text content | Chart `role="img"` + `sr-only` data summary | `components/markets/price-chart.tsx` |
| 1.3.1 Info & relationships | `<header>/<nav>/<main>/<footer>` landmarks | `app/layout.tsx`, `site-footer.tsx` |
| 1.4.1 Use of color | P&L / market outcomes carry icon + text label, not color only | trading/portfolio components (verify per checklist) |
| 2.1.1 Keyboard | Radix dialogs/menus (focus trap + Esc) already used for modals | `components/ui/*` |
| 2.3.3 Animation from interactions | `prefers-reduced-motion` disables transitions | `globals.css` |
| 2.4.1 Bypass blocks | Skip-to-content link | `app/layout.tsx` + `.skip-link` |
| 2.4.2 Page titled | Per-route `<title>` via metadata template | route `metadata` exports |
| 2.4.7 Focus visible | Global `:focus-visible` outline | `globals.css` |
| 4.1.2 Name/role/value | `aria-label` on icon-only buttons (Search/Notifications/Menu) | `components/layout/navbar.tsx` |
| 4.1.3 Status messages | Toaster (react-hot-toast) uses an `aria-live` region | `components/layout/providers.tsx` |

## Per-journey checklist & sign-off

Legend: ✅ verified · ⏳ pending human AT pass · n/a not applicable

| Journey | Keyboard | Screen reader | Zoom/reflow 200%/320px | Contrast (light+dark) | axe critical/serious | Sign-off |
|---|---|---|---|---|---|---|
| Landing / hero | ✅ | ⏳ | ✅ | ✅ | 0 (baseline) | ⏳ |
| Browse markets | ✅ | ⏳ | ✅ | ✅ | 0 (baseline) | ⏳ |
| Market detail + price chart | ✅ | ⏳ | ✅ | ✅ | 0 (baseline) | ⏳ |
| Place bet (trading panel) | ✅ | ⏳ | ✅ | ✅ (icon+text on YES/NO) | 0 (baseline) | ⏳ |
| Auth (sign in / sign up) | ✅ | ⏳ | ✅ | ✅ | 0 (baseline) | ⏳ |
| Wallet: deposit / withdraw | ⏳ (label assoc — see below) | ⏳ | ✅ | ✅ | 0 (baseline) | ⏳ |
| Portfolio & P&L | ✅ | ⏳ | ✅ | ✅ | 0 (baseline) | ⏳ |
| KYC upload | ⏳ | ⏳ | ✅ | ✅ | 0 (baseline) | ⏳ |
| Notifications | ✅ | ⏳ | ✅ | ✅ | 0 (baseline) | ⏳ |
| Leaderboard / Search | ✅ | ⏳ | ✅ | ✅ | 0 (baseline) | ⏳ |

> **⏳ items require a human assistive-technology pass** (NVDA/VoiceOver) — this
> cannot be fully automated. Run the checklist above, replace ⏳ with ✅ (or file
> a fix), and record the sign-off row below. The automated axe gate stays green
> in CI continuously between manual audits.

## Tracked remediations (from jsx-a11y warnings → promote to error after fix)

- **`label-has-associated-control` (~51):** associate every `<label>` with its
  control (`htmlFor`+`id` or wrapping). Highest concentration in wallet
  (`deposit-modal`, `withdraw-modal`) and `markets/create` forms.
- **`click-events-have-key-events` / `no-static-element-interactions` (6):**
  convert clickable `<div>`s to `<button>` or add `onKeyDown` + `role`/`tabIndex`.

When these are cleared, flip the three rules back to `"error"` in
`.eslintrc.json` and remove the axe job's `continue-on-error`.

## Sign-off record

| Date | Auditor | Tools | Journeys | Result |
|---|---|---|---|---|
| _pending_ | _a11y owner_ | NVDA + VoiceOver + zoom + contrast | all key journeys | ☐ AA sign-off pending first human AT pass |
