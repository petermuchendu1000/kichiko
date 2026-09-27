# Kalshi capture — 2026-09-27

Playwright 1.62.0 · Chromium 141.0.7390.37 · axe-core 4.12.1 · TLS verification on throughout.
One browser at a time, ≥3.5 s between requests to any host. No stealth, no UA rotation,
no CAPTCHA handling; the mobile viewport uses Playwright's standard iPhone UA for device
emulation.

**Read this first.**
- **Production kalshi.com was not rendered.** It answers this IP with `HTTP 429 … Vercel
  Security Checkpoint` (one confirming check, 08:31:34Z; no further attempts).
- **No Wayback (A-grade) captures.** Every attempt failed with `curl: (35) Recv failure:
  Connection reset by peer` (HTTP 000); archive.org's availability endpoint returned
  `429 Too Many Requests`. Retries at 08:33, 08:35, 08:38, 08:43, 08:50, 09:00, 09:16, 09:31
  UTC all failed. Targets are ready in `harness/targets-wayback.json` (home 20260617133624,
  /markets 20260129214045).
- **Rendered pages come from demo.kalshi.co**, Kalshi's official public demo, linked from
  its Help Center (article 13823775). It loads normally with no evasion. Graded **D**. Its
  equivalence to production is **UNVERIFIED** and its market data is mock (e.g. three
  candidates each at 99.9%). Treat D values as the *design system*, never as live data.

## Evidence grades

| Grade | Meaning | Date |
|---|---|---|
| **D** | Rendered live from demo.kalshi.co; computed styles and element boxes | 2026-09-27, 08:57–09:26 UTC |
| **M1** | Rendered live from production Kalshi sites that answer normally (help.kalshi.com, news.kalshi.com). The July corpus is also M1, dated July 2026 | 2026-09-27 / 2026-07 |
| **M2** | Public API (production and demo) and docs.kalshi.com | 2026-09-27 |
| **M3** | Help Center text, dated by each article's sitemap last-modified | per article |
| **M3-img** | Images embedded in Help Center articles, dated by the recording date in the filename where present, else UNDATED | per image |
| **S** | App-store listings, images stored as served | retrieved 2026-09-27 |
| **A** | Wayback archive — none obtained | — |
| **U** | Secondary sources — none used | — |

## Routes

Worked: demo (60 rendered captures, each fold PNG + full JPEG + JSON + axe); App Store
(iOS id 1632713844) and Google Play (12 official screenshots + listing data); help.kalshi.com
(61 articles transcribed, 27 embedded images, 2 pages rendered M1); docs.kalshi.com (fee
rounding, fixed-point pricing, series schema); news.kalshi.com (M1); public API, production
and demo (16 payloads, all HTTP 200). Not fetched: `kalshi.com/docs/kalshi-fee-schedule.pdf`
(blocked site; the schedule renders on the demo at `/fee-schedule`). A first App Store id
guess (6448207512) returned 404; the iTunes search API gave the correct id.

The auto-opening sign-up modal was dismissed with its own Close button before measuring; the
delay before it appeared is logged per capture, and the modal itself is captured as P11.

## Coverage (mobile 390×844 dpr 2 · desktop 1440×900 dpr 1; A column NOT MEASURED everywhere)

| Page | D mobile | D desktop | Other sources |
|---|---|---|---|
| P01 home | ✓ (+ dark) | ✓ (+ dark) | S iOS#2, Play#2; M3-img 2025 |
| P02 category / browse | ✓ `/category/politics`, `/browse` | ✓ | M3-img 2025-02-20 |
| P03 binary event | ✓ (+ dark) | ✓ (+ dark) | M3-img 2025-03-05; M2 |
| P04 multi-outcome | ✓ | ✓ | S iOS#1, #4, #5; M2 KXIPO-26 |
| P05 live sports | ✓ pre-game + `/calendar` | ✓ | S #3; M2. In-play NOT MEASURED |
| P06 ticket: default, Yes, No, $25 entered, pressed | ✓ bottom sheet | ✓ | — |
| P06 confirm / review | NOT MEASURED (login) | NOT MEASURED | M3-img 2025 only |
| P07 search | NOT MEASURED (no logged-out entry point) | ✓ | — |
| P08 leaderboard | ✓ login wall only | ✓ login wall only | M3, M3-img |
| P09 profile | ✓ demo account | ✓ | — |
| P10 portfolio | redirects to sign-in | redirects to sign-in | S #6; M3-img |
| P11 sign-up | ✓ modal + `/sign-up` | ✓ | M3 identity steps |
| P12 deposit | NOT MEASURED (login) | NOT MEASURED | M3 only |
| P13 help | ✓ D `/faq`, M1 help centre, M1 blog | ✓ | M3 |
| P14 legal / responsible trading | ✓ fee schedule, responsible trading, regulatory | ✓ | M3 |
| P15 404 | ✓ (HTTP 404) | ✓ | — |
| P16 navigation | header, footer; no mobile menu or tab bar logged out | ✓ + MORE menu | M3-img (app tab bar, 2025) |
| P17 social feed | ✓ `/ideas/feed` | ✓ | — |
| P18 settled market | ✓ | ✓ | M2 |

Totals: 60 rendered captures, 12 store images, 82 help image files (16 stills + 66 GIF key
frames; each GIF's URL, size and checksum logged), 61 help articles, 16 API/docs payloads.
51 MB written (41 MB screenshots, 11 MB data).

## Decision-relevant findings

1. **Price display depends on the surface (D, S).** Cards and feeds: a % pill plus a payout
   multiplier ("85%", "1.15x"). Cents only on Yes/No buttons and in the ticket ("YES 86¢ /
   NO 15¢"), including sub-cent ("97.4¢").
2. **Displayed Yes + No exceed 100 (D, M2).** The ticket shows asks: 86 + 15 = 101 on the
   demo; production API KXIPO-26 (Discord) asks 0.20 + 0.85 = $1.05.
3. **July's two semantic colours confirmed (D):** green `--green-x10 #0AC285`, red
   `--red-x10 #D91616`; brand `#28CC95`.
4. **The green CTA fails contrast (D, pixel-checked).** White on `#0AC285` = **2.32:1**
   ("Sign up to trade", selected Yes); header "Sign up" white on `#28CC95` = **2.07:1**. Red
   `#D91616` passes at 5.15:1. Dark mode uses dark text on `#28CC95` = 9.48:1.
5. **Ticket geometry (D):** card 352×400, radius 16, 1px border at 6% black, no shadow;
   Yes/No track 196×32 with a sliding 96×28 pill; amount field 318×44 radius 8; primary
   button 318×44 fully rounded, 15px/500; max payout in the condensed face at 30px.
6. **BUY/SELL tabs (D):** 13px/600, 0.08em tracking, uppercase; active state by colour only,
   no underline (contradicts July's 700 + underline).
7. **Fees (D fee schedule):** most markets a taker fee of $0.07–$1.75 per 100 contracts; a
   0.5 multiplier gives $0.04–$0.88; combo makers pay 50% of taker; 31 series non-standard.
   Consistent with 0.07 × C × P × (1 − P) rounded up (INFERENCE; the formula PDF is on the
   blocked site). "$25 at 86¢ → Max payout $28.77" is consistent with fee-inclusive display.
8. **Last documented confirm step (M3-img, recorded 2025-02-27):** "You're buying $1.75" with
   an ⓘ "Includes a fee of $0.07"; presets $50/$100/$250; "Don't be lazy - read the rules!";
   Submit. The 2026 confirm step is NOT MEASURED.
9. **Colour change since early 2025 (M3-img, 2025-02-20):** web ticket then used blue Yes /
   purple No with a "Review order" step and an "Order completed" panel.
10. **Aggressive logged-out conversion (D):** a "Create your account" modal opens unprompted
    **7.5–10.6 s after load** on 44 of 60 captures; desktop "Sign up to trade" opens a Log in
    modal; on mobile Google's "Sign in to Kalshi with Google" card covers the ticket bottom.
11. **Mobile ticket is a bottom sheet** announced as "Order panel"; ticket state is in the URL
    (`?op_market_ticker=…&op_order_side=yes&op_side=BUY`), so it is linkable.
12. **Type (D, from style tokens):** a regular face (400/500/600) and a condensed face (500)
    for headlines and big numbers. Body 12/13/15/18; uppercase labels 11 and 13 at 0.08em;
    headlines 24/26/30; display 44/56/96.
13. **Radii 2/4/6/8/16/100 and two shadow levels (D);** content width 1320; header 107 tall.
14. **Dark mode exists and follows the OS (D):** `#0A0C0F`, `#13161A`, `#1B2029`; green
    `#28CC95`; red `#FF4D6A`.
15. **Small targets (D):** only 7–10% of mobile event/home controls are ≥44px on the short
    side; row Yes/No 167×32; ticket pills 96×28; mobile help centre 85% under 24px (M1).
16. **axe (D):** every product page has critical and serious violations, chiefly unnamed
    buttons, missing alt text and contrast; e.g. game page desktop 13 critical / 55 serious.
    Disclaimer footer 2.11:1.
17. **Responsible trading (M3):** breaks of ≥1 day; self-exclusion plus SelfExclude.io across
    prediction-market sites; a monthly deposit cap that cannot be lifted until it expires
    (increases apply next month); Birches Health and 988 links; positions cannot be sold
    during a break.
18. **Onboarding and deposits (M3, 2026 articles):** 18+; 4-digit email and SMS codes; live ID
    photo (camera-roll refused); possibly SSN; review ≈48 h. Deposits min $10 ($1,000 wire);
    debit card "may incur 2%"; bank transfer free with partial instant credit. Non-US: card,
    crypto, wire only.
19. **App stores (S, 2026-09-27):** iOS 4.8★ / 554K ratings, #1 Finance, 25 releases 10 Aug–25
    Sep 2026; Play 4.7★ / 122K reviews, 1M+ downloads, updated 22 Sep. All screenshots dark
    theme. Promo codes differ by store (iOS "BEAST55"; Play "2KSIGNUP Up to $2,000").
20. **Leaderboard, portfolio, social (D, M3):** leaderboard behind "Unlock the leaderboard"
    login wall with users opted out by default; portfolio requires login; social profiles
    show Profit, Volume, Following, Followers; posts embed P&L cards with leverage.

### Per-page detail
- **P01:** outcome rows with a colour underline, "1.15x" under "Pays out", outlined 80×38 %
  pill. Mobile header has an unlabeled 16×36 icon button that did nothing on click. ≥44px
  controls: 10.3% mobile, 14.4% desktop.
- **P03:** chart range tabs `#0000004D` grey, 1.99:1 on white.
- **P05 `/calendar`:** 29,513px tall on mobile; 0.1% of controls ≥44px.
- **P07 (desktop):** typing "bitcoin" opens Markets / Perps / Profiles tabs, category chips,
  rows with right-aligned %, "View all markets".
- **P10 (M3-img, older):** "Interest 3.75% APY"; 2026 help text says 3.25%.
- **P13 help centre (M1):** different font files (KalshiSans-Regular/-Semibold); 14 serious
  axe issues.
- **P15:** newspaper illustration, "Page not found", "let us know", black "Go to home page".
- **P16 MORE:** Community / Our policies / Our values / Research. 2025 app tab bar: Explore,
  Search, Portfolio, Ideas, More.
- **P18:** "FULL-TIME 35–14"; chart ends ✓ ATL 100%, ✗ GB 0%; rows show green "Yes" / red
  "No" results. Side panel still reads "To be determined" (unexplained demo behaviour). API:
  `result`, `settlement_value_dollars`.
- **API (M2):** prices as 4-decimal dollar strings; counts to 2 decimals, min 0.01;
  per-market price grid (`price_ranges`); 4 exchange shards; open 24/7 except Thu 03:00–05:00 ET.

## July corroboration

| # | July claim | Now (D, 2026-09-27) | Verdict |
|---|---|---|---|
| 1 | Yes green `#0AC285` | Same, as a named token | CORROBORATED |
| 2 | No red `#D91616` | Same, as a named token | CORROBORATED |
| 3 | Pill/button radius 999px | 100px (identical at these heights) | CONTRADICTED (value); shape corroborated |
| 4 | Price text 16px/400 | Label + price one 13px/600 uppercase span | CONTRADICTED |
| 5 | Side label 13px/500 | 13px/600 | size CORROBORATED; weight CONTRADICTED |
| 6 | Tabs 13px/700, ~0.08em | 13px/600, 0.08em | size, tracking CORROBORATED; weight CONTRADICTED |
| 7 | Active tab accent underline | No underline; colour only | CONTRADICTED |
| 8 | Prices in cents | Cents in ticket; % + multiplier on cards; Yes+No > 100 | CORROBORATED (ticket); framing incomplete |
| 9 | Active side solid, inactive light grey | Sliding pill on `#F2F2F2` track | CORROBORATED |
| 10 | Market question muted and small | 15px, full-strength colour | CONTRADICTED |
| 11 | Avatar + bold outcome name | Condensed 24px/500 | CORROBORATED (not bold) |
| 12 | DOLLARS ⌄ toggles Dollars/Contracts | Present; help confirms both | CORROBORATED; menu UNCHECKED |
| 13 | Amount: unit left, value right | Same | CORROBORATED |
| 14 | "55% chance" row | "87% chance" | CORROBORATED |
| 15 | Max payout with resolution date | Same | CORROBORATED |
| 16 | Each contract pays $1 | Store listing says the same | CORROBORATED (S) |
| 17 | Green full-width rounded "Sign up to trade" | Same, 318×44 | CORROBORATED |
| 18 | Logged-in "Buy Yes" / "Review order" | 2025 help images only | UNCHECKED |
| 19 | Market/Limit; GTC/EOD/IOC | Types confirmed; expiry list absent from 2026 help | types CORROBORATED; expiry UNCHECKED |
| 20 | "3.25% Interest" | Present in ticket | CORROBORATED |
| 21 | Social/activity rail | Present | CORROBORATED |
| 22 | Reference market kxipo-26 | Live, 29 markets | CORROBORATED |
| 23 | "No dark mode" | Dark mode exists; full palette captured | gap filled |

## NOT MEASURED
1. All of production kalshi.com; demo-to-production equivalence unverified.
2. All Wayback (A) captures.
3. Live in-play sports state.
4. 2026 ticket confirm, submit, success and error (requires an account; none created).
5. DOLLARS menu contents, Limit panel, SELL tab, insufficient-balance state.
6. Mobile search and the search results page.
7. Leaderboard content and portfolio page.
8. Deposit screens.
9. Logged-in navigation.
10. Real in-app UI (store screenshots are marketing mock-ups; no pixels measured from them).
11. Truncation, hover, focus, pressed states and animation timings.
12. Exact fee-formula text (blocked site).
13. Any real production price or volume on a rendered page.
14. Google Play "What's new" text.
15. RTL, other languages, reduced-motion and forced-colours modes.

## Files
- `shots/`: `kalshi_<Pxx>_<D|M1>[-variant]_<mobile|desktop>_{fold.png,full.jpg}`;
  `kalshi_<Pxx>_S_*` (store); `kalshi_<Pxx>_M3img_HELP_*` (help images and GIF key frames).
- `data/`: one JSON per capture; `summary.json`, `pixel-contrast.json`,
  `P06_D_ticket-geometry_desktop.json`, `css-type-and-radius-tokens.json`,
  `store-listings.json`, `help-gif-keyframes.json`, `help-image-dates.json`,
  `wayback-retry-log.txt`, `probe.txt`; `raw/` (API, help, docs, CSS, store pages).
- `harness/`: `capture.js`, `measure.js`, `probe.js`, `actions.js`, `ticket-geometry.js`,
  `summarize.py`, `pixel_contrast.py`, `fetch-help.py`, `help-images.py`, `gif-keyframes.py`,
  `wayback-wait.sh`, `targets-*.json`.

*Report text supplied by the capture agent; saved verbatim in substance by the lead.*
