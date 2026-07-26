# Design — Phase 0 Foundations

This folder holds the Kichiko product-design foundations that precede UI implementation.

## Contents
- **[LANDING-PAGE-DOSSIER.md](./LANDING-PAGE-DOSSIER.md)** — the single source of truth for the visual + interaction language ("Pip" design system): competitive research (Polymarket, Kalshi, PremiumBlock), differentiated positioning, full design tokens (color, type, spacing, grid, elevation, motion, iconography), accessibility (WCAG AA+), SEO & performance strategy, the landing-page specification (IA, wireframe, component specs, review gates), and the implementation roadmap.
- **[landing-prototype/](./landing-prototype/)** — a static, framework-free reference implementation of the landing page built directly against the dossier's tokens (bespoke CSS custom properties — no utility-framework dependency). Open `index.html` in a browser. It demonstrates: the featured live market card with animated probability rolls, the live ticker, category browse, featured markets grid, "how it works", plain-language LMSR pricing, trust & transparency, count-up stats, dark/light theming (system-aware + toggle), EN/SW hooks, JSON-LD, and full reduced-motion / keyboard / focus-visible accessibility.

## Status
Phase 0 is complete (research → design system → landing page). Next phases port these tokens into `apps/web` (CSS variables + Tailwind theme + a TS token module and Storybook components), then build the Markets discovery and Market detail pages. See §4 of the dossier for the roadmap.
