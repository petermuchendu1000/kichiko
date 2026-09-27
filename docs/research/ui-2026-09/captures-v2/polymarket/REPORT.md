# Polymarket UI capture v2 — measured page by page

- **Capture window:** 2026-09-27. Link discovery 08:33Z; final full run 09:17:08Z–09:42:19Z,
  then the mobile-flow re-run and a viewport-meta probe (`data/run-log.txt`).
- **Engine:** Chromium 141.0.7390.37 headless (`/opt/pw-browsers/chromium-1194`),
  playwright-core 1.62.0, axe-core 4.12.1.
- **Network:** agent proxy, TLS verification on. No bot evasion, no UA/IP rotation.
  Sequential navigations ≥3.2 s apart.
- **Region:** the site treats this exit IP as US. The geo sheet appears on every load and the
  header Log in / Sign up are `display:none`.
- **Nothing submitted.** Amounts were typed; Trade was clicked only to see the gate.
- **Grades:** M1 computed style / geometry on a rendered node; M3 copy transcribed from the DOM.
  Colours are sRGB values Chromium rasterised over white and over black.
- **Viewports:** 390×844 mobile and 1440×900 desktop (desktop layout width 1425 px: headless
  Chromium draws a 15 px scrollbar), each light and dark.
- Headline contrast ratios (#8b929b 3.14, #04af52 2.89, #f6c030 1.68, #bfc3ca 1.77,
  white on #2e5cff 5.13) were independently recomputed by the lead and reproduce exactly.

## Method and files

`harness/run-all.sh` runs the pipeline, one browser at a time. `harness/lib.js` does in-page
extraction (structure, type, contrast with ancestor alpha compositing, interactive elements,
spacing, copy) and the axe scan. `capture.js`, `interactions.js`, `perf.js`, `pixeldiff.py`,
`summarize.js`, `coverage.js`, `discover*.js` do what their names say. Page data:
`data/<id>-<vp>-<theme>.json`; interactions: `data/P06-*`, `P07-states-*`, `P11-*`, `P16-*`,
`P01-geogate-*`, `P06-hoverfocus-*`, `P06-P11-flows-*`; `data/summary.json`, `data/perf.json`.
Shots: `-fold.png` (above the fold at device pixel ratio), `-full.jpg` (full page, JPEG q70,
CSS-pixel scale), `-skeleton.jpg` (at DOMContentLoaded). 41.5 MB total: 234 screenshots, 91
data files.

**Themes.** Both the menu's "Dark mode" switch and the OS dark setting set
`data-theme="dark"` (body `lab(3.97501 -0.0636876 -3.07571)`); the switch also stores
`color-mode=dark`. Captures used the OS setting. help.polymarket.com ignores it.

**URLs, all found by following links (except P15):**

| Page | URL | Found via |
|---|---|---|
| P02 | /politics | header nav |
| P03 | /event/will-the-us-invade-iran-before-2027 | /politics card "16% chance Yes No" |
| P04 | /event/los-angeles-mayoral-election-117 | home hero |
| P05 | /sports/atp/atp-gaston-rublev-2026-09-26 | /sports/live, card showing "S2" |
| P07 | /search?_q=ballon | home trending chip |
| P08 | /leaderboard | footer |
| P09 | /@papeasy | leaderboard #1 |
| P13 | help.polymarket.com | footer |
| P14 | /tos | footer |
| P17a | /breaking | nav |
| P17b | /activity | More menu |
| P18 | /event/btc-updown-15m-1774188000 | P09 "Closed" tab |
| P15 | /kichiko-capture-nonexistent-page-404 | deliberately invalid |

## Coverage

| Page | mobile light | mobile dark | desktop light | desktop dark |
|---|---|---|---|---|
| P01 home | ✓ (200) | ✓ | ✓ | ✓ |
| P02 /politics | ✓ | ✓ | ✓ | ✓ |
| P03 binary event | ✓ | ✓ | ✓ | ✓ |
| P04 multi-outcome | ✓ | ✓ | ✓ | ✓ |
| P05 live game (ATP, set 2) | ✓ | ✓ | ✓ | ✓ |
| P06 ticket | default, No, amount 10, invalid 99,999,999 and 0, gate | same | same + hover/focus | same + hover/focus |
| P07 search | results + open / results / no-results | same | same | same |
| P08 leaderboard | ✓ | ✓ | ✓ | ✓ |
| P09 profile | ✓ | ✓ | ✓ | ✓ |
| P10 portfolio | NOT MEASURED — no link logged out | — | — | — |
| P11 auth | NOT MEASURED — Sign up/Log in open the geo gate (gate captured) | same | ✓ via Help → "log in here" | ✓ |
| P12 deposit | NOT MEASURED — no link | — | — | — |
| P13 help centre | ✓ | ✓ (no dark theme offered) | ✓ | ✓ (no dark theme) |
| P14 terms | ✓ | ✓ | ✓ | ✓ |
| P15 404 | ✓ (404) | ✓ | ✓ | ✓ |
| P16 navigation | More drawer, header, footer, tab bar | same | user menu, more-nav, help popover, header, footer | same |
| P17a Breaking / P17b Activity | ✓ | ✓ | ✓ | ✓ |
| P18 resolved | ✓ | ✓ | ✓ | ✓ |

## The 20 most decision-relevant findings

1. **Dark is far more accessible than light.** Text failing AA: light 20.1–22.0%, dark
   4.0–4.1%.
2. **Feed Yes/No chips** are 40×27 px; light 4.36:1 / 4.28:1 (fail), dark 8.71:1 / 6.34:1.
3. **Pinch-zoom disabled** (`maximum-scale=1`); axe `meta-viewport` on 52 of 56 captures.
4. **No visible keyboard focus in the ticket**: Trade, Yes, No change 0 px on focus; feed
   chips show a ring (154 px changed).
5. **No inline validation**: for "0", "0.5", "-5", "abc", "99,999,999" there is no error text,
   no `aria-invalid`, Trade stays enabled. Amount font shrinks 40→35 px (desktop), 56→45 px
   (mobile) to fit.
6. **Every submit hits the US geo modal.** Escape "Continue in view only mode" is a 169×16 text
   button; primary "Go to polymarket.us" 342/352×48, radius 24.
7. **Selected No is solid red** (`#df0c10`, white text) in the desktop ticket — corrects v1.
8. **Sides priced separately:** Yes 16¢ + No 85¢ = 101¢ (M3).
9. **LCP 7.48–7.84 s** on the throttled mid-range-Android profile; LCP element is the geo-sheet
   paragraph on all three pages. FCP 2.10–2.17 s, TTFB 261–367 ms, CLS 0.0066–0.0279.
10. **Heavy pages:** 4.7–5.1 MB per page, JS 3.17–3.52 MB over 166–181 requests; long tasks
    total 10.0–12.4 s, longest 3.3–3.8 s; fonts 350–699 KB; Facebook + GTM ≈320 KB on home.
11. **Server-rendered first paint, no skeleton observed** (home 5,274 chars at DCL vs 5,124
    settled; event pages 69–75%).
12. **Taps from home** (geo dismissal not counted): amount entered — 3 + typing mobile, 2 +
    typing desktop; gate on submit — 4 / 3; auth — 2 / 2 (mobile ends at the geo gate).
13. **Feed card** 358×180 mobile, 12 px gap, 36 cards; tab bar 390×60, four 97.5×59 tabs.
14. **Light grey `#8b929b` on white = 3.14:1** — footer links, CFTC disclaimer, volume text on
    22 of 26 light captures. Accent green `#04af52` = 2.89:1 for wins and deltas.
15. **Worst contrast:** P04 legend `#f6c030` 1.68:1 at 26 px; P05 score digits `#bfc3ca`
    1.77:1 down to 9 px; P09 "shares" 1.96:1.
16. **Unnamed buttons** are the top critical axe issue: `button-name` in 28/56 captures, up to
    21 nodes (P04 desktop); auth provider tiles unnamed.
17. **Targets (smaller dimension), mobile:** 13.0% ≥44, 45.4% 24–43, 41.5% <24. /activity
    desktop: 336 of 377 under 24 (many are 20 px inline footer links WCAG 2.5.8 exempts).
18. **Search has no empty state:** "zzqxjvwk" still shows unrelated markets after 6 s. Mobile
    input 16 px (no iOS zoom), desktop 14 px.
19. **Number formats vary by surface (M3):** cards `62%`, `<1%`, `$14M`; event `$69,753,899
    Vol.`; buttons `58.6¢`; sports `$187.04K Vol.`; search `$4.5K Liq.`; leaderboard
    `+$5,086,914`. **No fee text anywhere** in ticket or event page.
20. **Spacing and radius:** 2 px grid fits ≥97% of values on every page (4 px 65–79%, 8 px
    26–52%). Radii 5.2 / 7.2 / 9.2 / 15.2 + pills (shadcn `--radius` ±n family).

## Cross-cutting (M1)

**Type:** Inter on polymarket.com, Geist Mono on desktop. Sizes 9, 11, 12, 13, 14, 15, 16, 18,
20, 22, 24, 26, 28, 30, 32, 40, 45, 56 (45 and 56 only in the mobile amount input). Weights 400,
440, 450, 490, 500, 540, 580, 590, 600, 700 (variable-font values). Most repeated on home:
13/490/16 `#6b727b` metadata; 15/600/22.5 `#23272d` card %; 13/490 `#007e26` / `#df0c10`
Yes/No labels.

**Contrast, AA failures / text nodes:** mobile light 666/3,032 (22.0%), dark 123/3,028 (4.1%);
desktop light 795/3,957 (20.1%), dark 158/3,944 (4.0%). Unscorable text (transparent fill,
clipped) excluded and counted in the JSON.

**Targets:** mobile 13.0 / 45.4 / 41.5%; desktop 15.7 / 41.6 / 42.7% (≥44 / 24–43 / <24).
axe `target-size` in 14 of 56 captures.

**Spacing:** home mobile gaps 8 (×647), 6 (×198), 4 (×191), 16 (×130); paddings 12 (×236),
8 (×176), 14 (×160).

**Document:** `<meta name=viewport content="width=device-width, initial-scale=1,
maximum-scale=1, viewport-fit=cover">`; `lang="en"`; manifest; theme-color `#ffffff` /
`#0c0e13`; no horizontal overflow at 390 px.

**axe (captures of 56 where each rule fired):** meta-viewport 52, color-contrast 44,
button-name (critical) 28, aria-required-children (critical) 20, link-name 20,
aria-hidden-focus 19, target-size 14, aria-valid-attr-value 8, nested-interactive 8,
aria-allowed-attr 6, aria-prohibited-attr 4, link-in-text-block 4, frame-title 2,
scrollable-region-focusable 2.

## Performance (mobile; 1.6 Mbps / 750 kbps / 150 ms RTT / CPU 4×; cold cache; 1 run; 34–35 s)

| | P01 | P03 | P04 |
|---|---|---|---|
| TTFB | 261 ms | 343 ms | 367 ms |
| FCP | 2,156 ms | 2,104 ms | 2,168 ms |
| LCP | 7,480 ms | 7,844 ms | 7,808 ms |
| CLS | 0.0066 | 0.0279 | 0.0066 |
| DCL / load | 4,950 / 24,734 ms | 4,383 / 21,653 ms | 5,203 / 21,894 ms |
| Long tasks: count / total / blocking / longest | 37 / 10,044 / 8,194 / 3,844 | 42 / 12,434 / 10,334 / 3,666 | 35 / 10,547 / 8,797 / 3,327 |
| Transferred | 4,932 KB | 4,722 KB | 5,115 KB |
| JS / CSS / img / font | 3,173 / 90 / 137 / 699 KB | 3,515 / 91 / 369 / 350 KB | 3,523 / 91 / 512 / 350 KB |
| Document / fetch | 275 / 547 KB | 196 / 191 KB | 267 / 363 KB |
| Requests | 293 | 244 | 262 |

LCP element on all three: the geo-sheet paragraph. P01 third parties: googletagmanager 163 KB,
connect.facebook.net 159 KB. The 150 ms RTT sits on top of the proxy's own latency.

## Per page

- **P01 home.** Mobile top to bottom: US banner 48; sticky nav 104; search 260×40 at 16 px;
  topic chips 32; 36 cards 358×180, gap 12; footer 1,356; fixed "How it works" + tab bar 105.
  Desktop: 116 nav, 907×480 auto-rotating hero, 4-column grid. Chips 40×27, padding `0 14px`,
  radius 5.2. Copy `62%`, `$14M`, `$2.0–$2.25T`; CFTC/QCX disclaimer 12/400 `#8b929b` (3.14:1).
  axe color-contrast 112; button-name 11 desktop.
- **P02 /politics.** Filter chips 32 tall ("All" `#2e5cff` on `#eaeeff`, radius 6); FAQ
  accordion. AA failures light 31.9%, dark 0.7%. aria-hidden-focus 3.
- **P03 binary.** Mobile "16% chance" 20/600 `#2e5cff`; fixed Yes 16¢ / No 85¢ bar;
  bottom-sheet ticket. Desktop right-rail ticket 308×357. `$69,753,899 Vol.`; 101¢ sum; no
  fee. Failing: ticket outcome `#04af52` 2.89:1; unselected side 3.08:1. button-name 13/16.
- **P04 multi.** Buy buttons 173×44 mobile, 136×48 desktop, radius 7.2. Row "59%" vs button
  "58.6¢". Legend 1.68:1. button-name 18/21.
- **P05 live.** Moneyline, Game Spread, Set Handicap; "Build a combo" bar 52. Desktop columns
  190 / 724 / 372. "GASTON 29¢", "+4.5 83¢", `$187.04K Vol.`; 9 px score text; digits 1.77:1.
- **P06 ticket.** Desktop: Buy | Sell; Yes/No 148×48 radius 9.2; 40/600 amount; +$1/+$5/+$10/
  +$100 chips 30 tall, 1px `#e6e8ec`; Trade 308×43 `#2e5cff`. Mobile sheet 390×486: Yes | No
  segmented 32 tall; 56/600 amount; Trade 342×44. States: default Yes solid `#007e26`; No
  solid `#df0c10`; amount 10 → "To win $0.00 · Avg. Price 0¢"; invalid → no feedback; submit
  → geo modal. Hover: Trade shifts 1.5 px (1,275 px changed). Focus on Yes/No: 0 px changed.
- **P07 search.** "500 results for ballon", sort tabs, `$4.5K Liq.` ×14; mobile light fails AA
  on 32.2% vs 0% dark. Open: full-screen 390×830 mobile, 600×407 dropdown desktop. "Iran"
  topic card 4.12:1. Nonsense query: no empty state.
- **P08 leaderboard.** H1 32; period tabs; `+$5,086,914`; wins `#04af52` 2.89:1;
  aria-prohibited-attr 19, link-name 23.
- **P09 profile.** P/L chart 1D–ALL; `$0.33 (51.5%)`, `Up 58¢`, `-$28.3K`; shares 1.96:1.
- **P11 auth + geo gate.** Desktop modal 448×446: Google 400×52 radius 28; email 398×54 with
  inline "Continue" 2.89:1; eight 86.5×56 provider tiles, three unnamed. Geo gate: 390×337
  sheet / 400×336 dialog; primary 342/352×48; "Continue in view only mode" 169×16.
- **P13 help.** system-ui, `#1a1a1a`; 0 of 22 text nodes fail; no dark theme;
  aria-required-children 2.
- **P14 terms.** Body in an iframe (frame-title, scrollable-region-focusable). **No
  responsible-gambling link anywhere.**
- **P15 404.** HTTP 404; "Page not found", "If reloading doesn't fix it, let us know via
  Intercom or support team.", "Go back". Title generated from the slug.
- **P16 navigation.** Tab bar 390×60, tabs 97.5×59. More drawer 332×844: rows 292×30 at
  20/500, icons 36×36, Log in / Sign up. Desktop header 17 of 25 targets ≥44. User menu 240×425,
  40 px rows. Footer 34 of 49 links under 24.
- **P17a Breaking.** 22/600 numerals; movers 2.89:1. **P17b Activity.** "user · Up/Down · NN¢ ·
  ($11.64)"; 336 of 377 desktop targets under 24; "Up" 3.61:1.
- **P18 resolved.** Sticky "✓ Outcome: Up" (16/500 mobile, 18/500 desktop, `#2e5cff`, 5.13:1)
  replaces the Yes/No bar; ticket slot shows "Go to live market".

## Flows (geo dismissal, 1 tap, not counted)

| Flow | Mobile | Desktop |
|---|---|---|
| Home → amount entered | 3 + typing | 2 + typing |
| … → gate on submit | 4 | 3 |
| Home → auth | 2 (ends at geo gate) | 2 (auth modal) |

The chip's `outcomeIndex` survived into the ticket on desktop, dropped on mobile.

## Failures (exact)
- REPORT.md write refused to the subagent (`Subagents should return findings as text…`);
  saved by the lead from the returned text.
- P11 mobile Help → "log in here": `locator.click: Timeout 5000ms exceeded.` (no visible Help).
- Mobile home→ticket first run failed at "Buy Yes" (`Timeout 5000ms`); selector fixed; re-run
  succeeded (4 taps).
- P05 first pass: `no live game found` (detector missed "S2"); fixed, picked from /sports/live.

## NOT MEASURED
P10 portfolio and P12 deposit (no logged-out link); mobile auth modal; all logged-in states,
server-side validation and fee quote; non-US LCP (every LCP element was the geo sheet);
performance on desktop, on other pages, and repeatability (one run each); terms body text
(iframe) and any responsible-gambling page; help-centre dark theme (not offered); mobile
hover/focus, tab order, screen-reader output (accessible names approximated in-page);
contrast over images/gradients and transparent-fill text; skeletons on client-side navigation.

*Report text supplied by the capture agent; saved by the lead.*
