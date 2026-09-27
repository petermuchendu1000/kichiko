# UI program 2026-09: research reports and work plan

Four research streams run in parallel on 2026-09-27, each written to a report here,
then synthesised into [`20-WORK-PLAN`](20-WORK-PLAN.md). They build on, and do not
repeat, `docs/design/` and `docs/research/polymarket/`.

| Report | Question | Key result |
|---|---|---|
| [20-WORK-PLAN](20-WORK-PLAN.md) | What do we build, in what order, and how is it verified? | Not the landing page first. Phase 0 collapses 23 spec contradictions and kills ~725 dead CSS classes; the money path is Phase 2; landing is Phase 4 |
| [21-CORPUS-CATALOGUE](21-CORPUS-CATALOGUE.md) | What does the existing design corpus already establish, per surface? | 34 docs over 14 surfaces. **23 contradictions**, incl. 4 unretracted token positions and a KES-vs-¢ conflict. All competitor captures ~10 weeks stale; admin, deposit/withdraw, settings and dark mode undocumented |
| [22-UI-AUDIT](22-UI-AUDIT.md) | What is actually implemented in `apps/web`? | 54 routes, 73 API handlers, **no stubs, zero TODOs**, real "Pip" token system with an enforcing contrast test. But ~725 dead Tailwind classes break shipped legal pages, 0 UI tests, 0 error boundaries, 0 focus traps, i18n live in 2 of 174 files |
| [23-COMPETITOR-CAPTURE](23-COMPETITOR-CAPTURE.md) | What are the competitors' real, measured design tokens? | Polymarket on a **2px** spacing grid, hand-picked 11–28px type ramp, fixed 180px cards. **YES tint 4.36:1 and NO tint 4.28:1 both FAIL WCAG AA**, accent green 2.89:1, and **89.8% of mobile home touch targets are <44px**. Kalshi NOT MEASURED (bot challenge) |
| [24-PSYCHOLOGY](24-PSYCHOLOGY.md) | What does the behavioural literature require of a real-money UI? | 25 testable rules, ~70 sources. Loss-in-money framing raises comprehension 27→52%, while payout-% framing *increases* perceived win chance; limit **prompts** have zero effect on losses (n=4,328 RCT) so ship default limits; y-axis truncation is not fixable by break markers |

**Evidence grades:** **M1** instrument-measured, **M2** API snapshot, **M3**
DOM-transcribed, **V** verified against our own code or production DB, **A** asserted
or designed, **U** unverified. Unlike the engine program, the prior design corpus
carries no evidence tags at all — grades in 21 were assigned by re-reading method prose.

**Reproducing the capture.** `experiments/competitor-capture/` holds the Playwright
harness, raw JSON (1.3 MB), resolved colours and screenshots. Colours authored in
`lab()`/`oklab()` were resolved to sRGB by Chromium itself, not converted by hand.
Re-running produces a diff against the committed JSON — that is the anti-rot mechanism.

**The thesis in one line.** Take Polymarket's information architecture, density system
and typographic hierarchy; reject its accessibility and touch ergonomics; keep our
token system, dark mode and enforcing tests. The edge is not novelty — it is that
their most-rendered semantic treatment fails AA and ours is tested not to.
