# Kichiko — Landing Page Design Review & Elevation Pass
### Review loop against the world-class bar (Apple · Stripe · Linear · Bloomberg)
**Reviewer:** Product Design Org (Principal PD · UX · Design Systems · Frontend Arch · Visual · Brand · A11y · SEO · Perf · Sr. Eng)
**Scope:** Landing page (`/`) and its shared chrome (navbar, footer). Backend/data contracts are read-only for this pass — no schema or query changes.
**Baseline:** `tsc --noEmit` clean; landing already ported to the "Pip" design system (see `LANDING-PAGE-DOSSIER.md`).

---

## 1. What already meets the bar (keep, do not touch)

The existing landing is genuinely strong and should not be regressed:

- **Token-only styling.** Every surface reads from CSS custom properties (`--surface`, `--text`, `--pip-500`, market semantics). No magic hex in components. Dark/light both derive from the same tokens.
- **Bespoke iconography.** `components/ui/icons.tsx` is a hand-built SVG set with a custom `LogoMark` (rising probability line + pip terminals). No Lucide/Heroicons as the visible language — meets the "no recognizable icon library" rule.
- **Restraint.** One brand-blue radial wash in the hero, desaturated YES/green & NO/red market semantics (never neon), 8px-derived radii, structure-with-lines-not-shadows. Reads institutional, not casino.
- **Comprehension-first hero.** Live featured market card with probability lead, prob bar, deterministic sparkline, volume/traders — a newcomer can read one card and read them all.
- **Honest liveness.** `animate-pulse-dot` + ticker with `prefers-reduced-motion` fully honored; no flashing.
- **Trust before money.** "How it works", plain-language LMSR explainer, and a transparency section all appear before any deposit prompt.

**Verdict:** hero, section rhythm, LMSR explainer, and trust grid ship as-is.

---

## 2. Findings — where it falls short of the bar

Reviewed as if critiquing another team's PR. Prioritized by user-visible craft impact.

### F1 — The footer is the weakest surface on the page (HIGH)
The current `site-footer.tsx` is a single thin row with four links. Problems:
- **Light-mode bug:** links use `hover:text-white`, which turns text white-on-white in the default light theme — effectively invisible on hover.
- **Grid misalignment:** footer uses `max-w-7xl px-4` while the landing content column uses `max-w-6xl px-5 sm:px-8`. The footer's left edge does not line up with the hero, sections, or CTA band — a visible craft flaw at desktop widths.
- **Missing compliance surface:** a real-money prediction market must carry a **risk / responsible-play disclosure** and its regulatory posture in the footer. Absent today. This is a trust and (for launch) a compliance gap, not just aesthetics.
- **No brand anchor:** no logo mark, tagline, product/company/legal columns, settlement currencies, or payment rails — the elements every institutional fintech footer uses to close the page with confidence.

### F2 — Container width is inconsistent across the chrome (MEDIUM)
Navbar (`max-w-7xl px-4`) and footer (`max-w-7xl px-4`) disagree with the landing body (`max-w-6xl px-5 sm:px-8`). The sticky nav's logo therefore does not align with the hero's left edge. Standardize the shared page gutter.

### F3 — No JSON-LD / structured data on the live page (MEDIUM, SEO)
The static prototype documents an Organization/WebSite schema, but the shipped `app/page.tsx` emits none. Adding `Organization` + `WebSite` JSON-LD improves rich-result eligibility with zero visual cost. (Tracked here; implemented in this pass only if it stays fully additive and typed.)

### F4 — Footer lacks a theme/locale affordance parity (LOW)
Locale switcher is present but visually orphaned. Fold it into a structured "settings" row so it reads as intentional, not leftover.

---

## 3. Elevation plan (this pass)

Fully additive, no backend changes, `tsc` must stay green.

1. **Rebuild `site-footer.tsx`** to an institutional multi-column footer:
   - Brand column: `LogoMark` + wordmark, North-Star tagline, settlement currencies + payment rails (reusing the hero's clean tabular treatment).
   - Link columns: **Markets**, **Company**, **Legal & compliance** (Terms, Privacy, Responsible play, Help).
   - **Risk & responsible-play disclosure** band — plain-language, always visible.
   - Bottom bar: copyright, region line, locale switcher — grid-aligned to the page.
   - Token-only styling; correct light + dark hover states (no `hover:text-white`); real `<nav>`/`<footer>` landmarks and `aria-label`s preserved.
2. **Align the shared gutter** — footer (and, low-risk, navbar containers) to `max-w-6xl px-5 sm:px-8` so chrome and content share one grid.
3. Keep all changes reversible and committed incrementally to `main` with status checks before each push.

---

## 4. Review gates (must pass before "done")

- [ ] Would Stripe/Linear ship this footer? (structure, hierarchy, restraint)
- [ ] Light **and** dark verified — no invisible hover, no low-contrast text (WCAG AA+).
- [ ] Footer left edge aligns pixel-for-pixel with hero + sections at ≥ md.
- [ ] Landmarks + labels intact; keyboard focus visible on every link.
- [ ] Risk/responsible-play disclosure present and legible.
- [ ] `tsc --noEmit` clean; no new deps; tokens-only (no magic values).
