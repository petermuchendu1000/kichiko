# UI program 2026-09: research reports and work plan

**Current:** [41-WORK-PLAN-V2](41-WORK-PLAN-V2.md) (the plan) and
[40-ELEMENT-MATRIX](40-ELEMENT-MATRIX.md) (Polymarket × Kalshi × Kichiko, every page and element,
with a ruling each). Everything below them is evidence.

| Report | Question | Key result |
|---|---|---|
| [41-WORK-PLAN-V2](41-WORK-PLAN-V2.md) | What do we build, in what order, and how is it verified? | Not the landing page first: legal exposure (two live court-case markets, "Predict & Earn"), then untrue numbers (truncated charts), then the ticket. Landing is Phase 4. Every rule maps to a named CI gate |
| [40-ELEMENT-MATRIX](40-ELEMENT-MATRIX.md) | For each page and element, what do the three products do, and what do we rule? | Kichiko leads on contrast (0.1–0.4% of text failing vs PM 4–22%), targets (31.5% ≥44 px vs 13% / 7–10%) and weight (≈0.5 MB vs ≈5 MB). It loses on density, number discipline and the ticket |
| [captures-v2/polymarket](captures-v2/polymarket/REPORT.md) | Polymarket, measured page by page, both themes, throttled | 234 screenshots. Light theme fails AA on 20–22% of text; pinch-zoom disabled; no ticket validation or focus; LCP 7.5–7.8 s; 4.7–5.1 MB per page |
| [captures-v2/kalshi](captures-v2/kalshi/REPORT.md) | Kalshi, by every legitimate route | kalshi.com blocked this server; 60 captures of Kalshi's official demo (grade D), store, help, API. Green CTA 2.32:1; Yes+No sum >100; auto-opening sign-up modal |
| [captures-v2/kichiko](captures-v2/kichiko/NOTATION-AUDIT.md) | Our own UI against live production data | 90 captures + throttled perf. Ticket: USD-derived chips, pre-filled KSh 130, ¢, `Ksh`/`KSH`/`KSh`, payout text 2.18:1 |
| [research-v2/31](research-v2/31-PSYCH-MONEY-RISK.md) | Money, probability, risk, harm, regulation (primary sources) | 4 of 13 prior rules confirmed, 8 overstated, 1 wrong. Kenya L.N. 112 regulates prediction markets directly; Uganda minimum age 25 |
| [research-v2/32](research-v2/32-PSYCH-MOBILE-TRUST.md) | Devices, touch, legibility, trust, onboarding (primary sources) | 70% of Kenyan mobile-money losses are accidental sends; sunlight collapses contrast; budget JS ≤150 KB, LCP ≤2.5 s Slow 4G |
| [research-v2/33](research-v2/33-KENYA-LN112-EXCERPT.md) | The gazetted regulation text | Reg. 45(5)–(8), verified first-hand |
| [20-WORK-PLAN](20-WORK-PLAN.md) | *(superseded by 41)* | First plan; several rules overstated, regulations from a draft |
| [21-CORPUS-CATALOGUE](21-CORPUS-CATALOGUE.md) | What does the existing design corpus establish? | 34 docs, 23 contradictions (0.2 rules on them via 40) |
| [22-UI-AUDIT](22-UI-AUDIT.md) | What is implemented in `apps/web`? | 54 routes, no stubs. Its dead-class figure was corrected (see its erratum) |
| [23-COMPETITOR-CAPTURE](23-COMPETITOR-CAPTURE.md) | First competitor capture (home + one event) | Superseded in coverage by captures-v2 |
| [24-PSYCHOLOGY](24-PSYCHOLOGY.md) | First psychology pass | Re-verified and corrected by 31 and 32 |

**Evidence grades:** **M1** instrument-measured, **M2** API, **M3** DOM-transcribed, **D** Kalshi
demo site (design only), **S** store listing, **V** verified against our code or production DB,
**A** archived, **U** unverified.

**Reproducing.** Each `captures-v2/<site>/harness/` re-runs its capture; the diff against the
committed JSON is the anti-rot mechanism.
