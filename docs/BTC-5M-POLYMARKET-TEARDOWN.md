# BTC 5-minute Up/Down — Polymarket teardown and parity spec

Measured against `polymarket.com/event/btc-updown-5m-*` on 2026-10-17 between
18:20Z and 18:50Z, with Chromium 140 at 1440×900, DPR 2, locale `en-US`,
timezone `America/New_York`.

Everything in this document was **observed** — captured from the live page, its
network traffic, its websockets, or its public APIs. Where a number is derived,
the derivation is shown and cross-checked against a second source. Nothing here
is inferred from how such a market "should" work.

Capture tooling lives outside the repo (session scratchpad): an instrumented
Playwright run recording every request/response body and websocket frame, plus
a computed-style probe. Raw captures: 467 requests, 18,639 websocket frames.

---

## 1. Market identity and lifecycle

| Fact | Value | Source |
|---|---|---|
| Event slug | `btc-updown-5m-<unix window start>` | URL |
| Series | `btc-up-or-down-5m`, id `10684`, `recurrence: "5m"` | `events.series[0]` |
| Series 24h volume | $8,484,127.59 | `series[0].volume24hr` |
| Series liquidity | $1,127,803.98 | `series[0].liquidity` |
| Window start | `eventStartTime`, exactly on a 5-minute wall-clock boundary | gamma |
| Window end | `endDate` = start + 300s | gamma |
| Resolution lag | `closedTime` − `endDate` = **53 s** (18:25:00Z → 18:25:53Z) | gamma |
| Auto-resolve | `automaticallyResolved: true`, `umaResolutionStatus: "resolved"` | gamma |
| Outcomes | `["Up", "Down"]`, `negRisk: false` | gamma |

**Windows are wall-clock aligned.** The slug is the window's start epoch and is
always `≡ 0 (mod 300)`. Verified across 1792261200 / 1792261500 / 1792261800 /
1792262100 / 1792262400.

**Windows open far in advance.** At 18:32Z the 18:35, 18:40 and 18:45 windows
were all `acceptingOrders: true` quoting 0.50 / 0.51 with `openInterest: 2.0`.
A trader can always see and trade the next several windows.

### Market configuration (the numbers that govern trading)

```json
"cryptoMarketConfig": {
  "id": "btc-5m-twap-60", "asset": "btc", "duration": "5m",
  "twapEnabled": true, "twapLookbackSeconds": 60
}
"feeSchedule": { "exponent": 1, "rate": 0.07, "takerOnly": true, "rebateRate": 0.2 }
"feeType": "crypto_fees_v2",  "feesEnabled": true
"orderMinSize": 5,  "orderPriceMinTickSize": 0.01 | 0.001
"rewardsMaxSpread": 4.5,  "rewardsMinSize": 50
"makerBaseFee": 1000,  "takerBaseFee": 1000
```

**Tick size is not constant.** The live 18:30 window reported
`orderPriceMinTickSize: 0.01`; the resolved 18:20 window reported `0.001`. The
batch `midpoints` poll caught the transition on a single token inside one
window: `0.005 → 0.005 → 0.005 → 0.0005 → 0.0005`. A midpoint of `0.005` is
`(0.00+0.01)/2` on a 0.01 grid; `0.0005` is `(0.000+0.001)/2` on a 0.001 grid.
So the grid refines to 0.001 once price reaches the extremes. The CLOB
`/tick-size` endpoint is authoritative per token and must be read, never
assumed.

---

## 2. Resolution mechanics — settled, not guessed

Rules text (verbatim): resolves **Up** if the Chainlink BTC/USD TWAP "of the
time range specified in the title is **greater than or equal to** the price at
the beginning of that range", source
`https://data.chain.link/streams/btc-usd-twap-60s-streams`.

The prose is loose; `/api/past-results` shows the actual arithmetic:

| Window (UTC) | openPrice | closePrice | outcome | percentChange |
|---|---|---|---|---|
| 18:10–18:15 | 81390.08102968412 | 81401.63712396199 | up | 0.014198406159165419 |
| 18:15–18:20 | 81401.63712396199 | 81429.47085316796 | up | 0.03419308282901828 |
| 18:20–18:25 | 81429.47085316796 | 81432.75815901317 | up | 0.004036997675125798 |
| 18:25–18:30 | 81432.75815901317 | 81450.03121458918 | up | 0.021211433784764266 |

Three independent confirmations:

1. **The chain is continuous**: `closePrice[N] ≡ openPrice[N+1]`, bit-for-bit,
   across every adjacent pair. So open and close are the *same series* sampled
   at the two window boundaries — not two different measurements.
2. **Cross-source agreement**: the 18:20 window's `eventMetadata.priceToBeat`
   is `81429.47085316796`, exactly its `openPrice` from `past-results`.
3. **percentChange reproduces exactly**:
   `(81401.63712396199 − 81390.08102968412) / 81390.08102968412 × 100 =
   0.014198406159165419`.

**Therefore:** `openPrice` = the 60-second-lookback TWAP sampled at window
start; `closePrice` = the same TWAP sampled at window end; **Up iff
`closePrice >= openPrice`** (ties resolve Up). It is *not* the mean of the TWAP
across the window, and *not* spot-vs-spot.

---

## 3. Data sources, exactly

### 3.1 Live price — `wss://ws-live-data.polymarket.com/`

One subscribe frame carries all three topics:

```json
{"action":"subscribe","subscriptions":[
 {"topic":"activity","type":"trades","filters":"{\"event_slug\":\"btc-updown-5m-1792262100\"}"},
 {"topic":"comments","type":"*","filters":"{\"parentEntityID\":10684,\"parentEntityType\":\"Series\"}"},
 {"topic":"crypto_prices_twap_sixty","type":"update","filters":"{\"symbol\":\"btc/usd\"}"}]}
```

Keepalive is a bare `PING` string (not JSON).

`crypto_prices_twap_sixty` update:

```json
{"payload":{"full_accuracy_value":"81445907877326212825088",
            "symbol":"btc/usd","timestamp":1792262122000,
            "value":81445.90787732622,"window_s":60},
 "timestamp":1792262122750,"topic":"crypto_prices_twap_sixty","type":"update"}
```

- **Exactly 1 Hz.** `payload.timestamp` always lands on a whole second
  (…122000, …123000, …124000, …).
- `full_accuracy_value` is an **18-decimal fixed-point integer**:
  `81445907877326212825088 / 1e18 = 81445.907877326212825088`, and `value` is
  that rounded to float64. The canonical figure is the integer.
- `window_s: 60` matches `twapLookbackSeconds`.
- Delivery lag (`frame.timestamp − payload.timestamp`): 750 ms, 1022 ms,
  1295 ms, 1280 ms, 2020 ms across the sample — **0.7–2.0 s**.
- Consecutive seconds sometimes repeat a value; the upstream stream does not
  always change.

### 3.2 Reference price — `GET /api/crypto/crypto-price`

```
?symbol=BTC&eventStartTime=2026-10-17T18:35:00Z&variant=fiveminute
&endDate=2026-10-17T18:40:00Z&twapEnabled=true&twapLookbackSeconds=60
→ {"openPrice":81445.66143370229,"closePrice":null,"timestamp":1792262109983,
   "completed":false,"incomplete":true,"cached":true}
```

`openPrice` 81445.66143370229 renders as **$81,445.66** — Price To Beat is this
value at 2 dp. While live: `closePrice: null`, `completed: false`,
`incomplete: true`.

### 3.3 Past outcomes — `GET /api/past-results`

Two calls. One with `count=4` plus `symbol/variant/twapEnabled/
twapLookbackSeconds/currentEventStartTime/endDate` returns the four
`results` rows (the table in §2) **and** `outcomesBySlug`. A second with
`outcomesOnly=true` returns `outcomesBySlug` alone for ~50 past slugs. The four
pills beside "Past" are `count=4`; the dropdown uses `outcomesBySlug`.

### 3.4 Order book — `wss://ws-subscriptions-frontend-clob.polymarket.com/ws/market`

Subscribe: `{"type":"markets","assets_ids":["<token>"]}`. Over 45 s: **17,888
`price_change`, 150 `book`, 86 `last_trade_price`** — roughly 400 frames/s.

`price_change` carries *both* tokens of the pair, each with `best_bid` /
`best_ask`, and they always sum to 1.00 (observed 0.47/0.53 and 0.48/0.52).

### 3.5 REST polling

`POST clob/midpoints` (batch, ~25 tokens, every 5–8 s) for the related-market
rail; `POST clob/last-trades-prices`; `GET clob/time` — **the countdown is
synced to CLOB server time, not the local clock.**

### 3.6 Gamma is stale — do not price from it

At 18:32Z gamma reported `bestBid 0.44 / bestAsk 0.45` and
`outcomePrices ["0.485","0.515"]`. The CLOB book at 18:33:29Z was
**0.22 / 0.23**, and 35 s later 0.07 / 0.08. Gamma's cached quote was wrong by
more than 20 cents. **Live price must come from the CLOB or its websocket.**

### 3.7 The two books are exact mirrors

Fetched atomically via `POST /books` (identical `timestamp` 1792262043539):

| UP ask | size | DOWN bid | size |
|---|---|---|---|
| 0.08 | 329.5 | 0.92 | 329.5 |
| 0.09 | 81.27 | 0.91 | 81.27 |
| 0.11 | 48 | 0.89 | 48 |
| 0.12 | 20 | 0.88 | 20 |

`UP.ask[p] ≡ DOWN.bid[1−p]`, sizes identical. One book, two views.

**Endpoint trap:** `/price?side=buy` returns the best **bid**, `side=sell`
returns the best **ask** — the opposite of the natural reading. Verified:
`buy=0.09, sell=0.10` with `midpoint=0.095`.

### 3.8 Trade feed shape

```json
{"asset":"...","conditionId":"0x...","eventSlug":"btc-updown-5m-1792262100",
 "outcome":"Down","outcomeIndex":1,"price":0.4800001430000501,
 "proxyWallet":"0x1E9a...","pseudonym":"Growing-Inauguration",
 "side":"BUY","size":3.076922,"timestamp":1792262122,"transactionHash":"0xb98f..."}
```

Fills are **not tick-aligned** (`0.4800001430000501`) and sizes are fractional
(`3.076922`). Several fills share one `transactionHash` — one tx, many fills.
These are the `+$9 / +$1 / +$7` annotations on the chart, coloured by outcome.

---

## 4. Design system — polykit

Tailwind with a `pk-` token layer, under `[data-polykit]`; dark mode via
`[data-theme="dark"] [data-polykit]`. Fonts: **Inter** (body) and **Open
Sauce**. Measured `--radius: .7rem` = **11.2px**.

Inter is loaded with explicit character variants:

```
--inter-font-features: "liga" 1, "calt" 1, "cv01" 1, "cv02" 1, "cv03" 1,
                       "cv04" 1, "cv09" 0, "cv11" 1, "cv15" 1
```

### Palette (light → dark)

| Token | Light | Dark |
|---|---|---|
| `--color-gray-50` | `#ffffff` | `#0a0b10` |
| `--color-gray-100` | `#f4f4f6` | `#17181c` |
| `--color-gray-200` | `#e7e8eb` | `#202227` |
| `--color-gray-500` | `#a0a3b1` | `#4e525f` |
| `--color-gray-600` | `#6b6e7a` | `#80838e` |
| `--color-gray-900` | `#1d1f24` | `#ecedee` |
| `--color-green-600` | `#34c759` | `#2bae4c` |
| `--color-green-700` | `#28a548` | `#2fbb53` |
| `--color-red-600` | `#df0c10` | `#f43437` |
| `--color-red-700` | `#c80b0e` | `#f55b55` |
| `--color-yellow-600` | `#ffd429` | `#efc500` |
| `--color-blue-600` | `#2e5cff` | `#4877ff` |

Alpha ramps exist as `--color-alpha-{50..900}` (black-on-light, white-on-dark)
plus fixed `--color-alpha-black-*` / `--color-alpha-white-*`.

### The live site does not use those base hexes

The page mounts
`[data-slot="polykit-color-scheme-provider"][data-polykit-color-scheme="experimental_polykit"]`,
which overrides the base ramp. Converting each palette hex *forward* into
CIELab(D50) — the form Chromium reports computed colour in — and matching
against what the page actually resolved shows the override: the nearest base
token to the resolved body text is `gray-900` at a Lab distance of 3.95, and to
the positive green is `green-700` at 6.04. Only the hairline matches a base
token (`gray-200`, distance 0.39).

**So the resolved values are the specification, not the tokens.** Measured:

| Role | Resolved | Where |
|---|---|---|
| content-primary | `#23272d` | h1, h3, "Rules", `$5` stake |
| content-secondary | `#6b727b` | labels, "Vol.", "Source:", "win" |
| positive green | `#04af52` | one-tap win amount |
| hairline border | `#e6e8ec` | one-tap buttons |
| BTC orange | `#ff9900` | "Current Price" label + animated price strip |
| page background | `#ffffff` | body |

### Typography, measured at 1440px

| Element | size / line-height | weight | letter-spacing | colour |
|---|---|---|---|---|
| `h1` market title | 24 / 28 px | 600 | −0.36 px | `gray-900` |
| Subtitle (`October 17, 2:35-2:40PM ET`) | 16 / 24 px | 500 | normal | `gray-600` |
| "Price To Beat" label | 12 / 16 px | 600 | −0.1 px | `gray-600` |
| Price value `$81,445.66` | 24 / 28 px | **620** | **+0.6 px** | — |
| "Current Price" label | 12 / 16 px | 600 | −0.1 px | `#ff9900` |
| `h3` "Order Book" | 16 / 20 px | 600 | −0.18 px | `gray-900` |
| "$160 Vol." | 14 / 20 px | 400 | normal | `gray-600` |
| "Rules" tab | 16 / 20 px | 600 | −0.18 px | `gray-900` |
| Interval pill ("5 Min") | 13 / 16 px | 600 | −0.1 px | h=32, r=11.2px, pad 0 12px, gap 8px |
| "Source: Polymarket.com" | 11 / 12 px | 600 | normal | `gray-600` |

Note the **620** weight — a variable-font axis value, not 600 — and the
**positive** 0.6px tracking on the price, against negative tracking everywhere
else.

### Animated numerals

`pk-animated-label__{strip,glyph,overlay,gesture}` implement a per-digit
odometer: each digit is a vertical strip of glyphs that translates. This is why
a mid-animation screenshot catches `Up ₅9¢` — two glyphs of one digit visible
at once. The countdown renders as `03 MINS 53 SECS` with per-digit columns.

Measured on the Current-Price strip:

```
position: absolute;  height: 28px;  overflow: visible;
font: 600 24px/30px inter;  letter-spacing: -0.36px;  color: #ff9900;
text-align: center;  transform: matrix(…)   /* the scroll */
width: per-glyph advance — 29px, 16.3125px, 30.625px observed
```

Each glyph is its own span with its own advance width (7.7 / 6.9 / 3.5 / 6.7 /
7.2 px for `$ 5 . 7 5`), so the strip is laid out per character, not
monospaced. Note the price strip is weight **600 / 30px line-height**, while
the static "Price To Beat" value is **620 / 28px** — the two numbers in the
same cluster are not the same type style.

### Chart is canvas, not SVG

The plot is **`lightweight-charts`** (TradingView). Four canvases:

| Canvas | Size | Role |
|---|---|---|
| z-index 1 | 922 × 260 | series pane |
| z-index 2 | 922 × 260 | crosshair / overlay pane |
| z-index 1 | 922 × 28 | time-axis pane |
| z-index 2 | 922 × 28 | time-axis overlay |

Plot area **922 × 260**, time axis **28** tall, total **288 px**, at a 1440
viewport. The page's 95 `<svg>` elements are all icons and the logo — none is
the chart. Any parity attempt that renders the plot as SVG will not match the
rasterisation, antialiasing or crosshair behaviour.

### One-tap buy panel, measured

```
container      h=118  w=308  gap=20px
label          "One-tap buy"  16px / 500
button row     h=78   gap=8px
button         w=97.3  h=78  radius=15.2px  padding=16px 12px  gap=2px  bg=#ffffff
stake          20px / 700 / #23272d          e.g. "$5"
"win"          12px / 500 / #6b727b
win amount     12px / 600 / #04af52          (itself an odometer strip)
```

### Payout arithmetic — verified

`shares = stake / ask_price`, displayed to **2 dp below $10** and **rounded to
whole dollars at or above $10**. Checked against two independent captures,
5 of 5 exact:

| ask | stake | computed | displayed |
|---|---|---|---|
| 0.59 | $5 | 8.4746 | `$8.47` |
| 0.59 | $25 | 42.3729 | `$42` |
| 0.59 | $100 | 169.4915 | `$169` |
| 0.87 | $5 | 5.7471 | `$5.75` |
| 0.87 | $25 | 28.7356 | `$29` |

---

## 5. Page anatomy (1440×900)

Measured positions, content column `x≈61.5 → 935`, right rail `x≈1027.5+`.

- **Header** — BTC icon (orange rounded square), `h1` at y=140, subtitle y=172,
  and three icon actions (embed `</>`, copy-link, bookmark) right-aligned.
- **Price cluster** (y≈228–276) — `Price To Beat` / value, a vertical divider,
  then `Current Price` / value with a `▲ $1` delta chip. Countdown
  `03 MINS 53 SECS` right-aligned in red, with a `Polymarket` watermark.
- **Chart** — y-axis labels on the **right**, dashed orange reference line with
  a `Target` badge pinned at the right edge, orange price line, trade
  annotations down the left, `Source: Polymarket.com` bottom-left (11px/600).
- **Chart controls** — `Past ∨`, four outcome pills (green up-chevron / red
  down-chevron), time tabs (`2:40 PM` active = black fill, others gray, the
  live one marked with a red dot), `More ∨`, and a 3-way chart-type toggle
  (line / BTC / candles).
- **Order Book** — collapsed card, title + info icon left, `$164 Vol.` and a
  chevron right.
- **Rules / Market Context** tabs, then the rules prose.
- **Right rail** — outcome header, `Buy`/`Sell` tabs, `1-Tap ∨`, two big
  outcome buttons (`Up 59¢` filled green / `Down 42¢` outlined), `One-tap buy`
  with $5 / $25 / $100 cards, Terms line, promo card, then `5 Min / 15 Min /
  1 Hour / 1 Day` and the related-asset rail (ETH / SOL / XRP / DOGE with live
  % and a red/green dot).

### Payout arithmetic on the one-tap cards

With `Up` at 59¢: `$5 → win $8.47`, `$25 → win $42`, `$100 → win $169`.
`5 / 0.59 = 8.4745`, `25 / 0.59 = 42.37`, `100 / 0.59 = 169.49`. So **win =
stake / price**, floored to whole dollars above $10 and shown to the cent below
it. The two buttons sum to 101¢ — they quote the **ask** on each side, so the
pair carries the spread.

### Post-close state

The countdown is replaced by a `● Go to live market ›` pill; the rail shows
"Hold on, determining winner… This market has ended. Final resolution will
appear automatically as soon as it is available on-chain." The just-ended pill
turns red/green. The chart keeps the frozen window.

---

## 6. Where Kichiko stands

Verified against the live database and the current branch.

**Sound already.** The tick pipeline runs at a genuine ~1 Hz (555 ticks over
9m32s, mean gap **1.03 s**, 43,226 rows). `btc_twap()` is a correct
time-weighted integral over a step series with a seed sample, and settlement
uses `twap60` with a documented NULL guard. `twapSeries()` computes the same
quantity client-side. The earlier session already identified the 60-second TWAP
and matched it.

**Gap 1 — windows are not wall-clock aligned.** Measured offsets into each
5-minute block for the last twelve 5m windows: 195, 199, 204, 209, 214, 218,
223, 227, 239, 246, 260, 264 seconds. Each window opens ~5 s later than the
last, because the window opens when the cron happens to fire. Polymarket's are
exactly `≡ 0 (mod 300)`. Consequences: a trader cannot anticipate a window, the
slug cannot carry a clean boundary timestamp, `2:40PM / 2:45PM` tabs are not
expressible, and the drift compounds indefinitely.

**Gap 2 — the probability is modelled, not traded.** `impliedUpProb()` is a
logistic of `(price − reference) / (reference · 0.00045 · √secs)`. That is a
fabricated curve with a hand-picked σ. Polymarket's number is the CLOB midpoint
— real order flow. Kichiko has `clob_orders` / `clob_fills` tables, so the
honest number is reachable.

**Gap 3 — oracle is a different series.** Ours is Coinbase trade prints
(fallback Kraken, CoinGecko) bucketed to seconds, then averaged. Polymarket's
is Chainlink's published `btc-usd-twap-60s` stream at 18-decimal precision. The
shapes agree; the series do not, and ours carries float64 rather than the
canonical integer.

**Gap 4 — palette and type diverge.** Ours: `UP_GREEN #1F9D6B`,
`DOWN_RED #D1495B`, `BTC_ORANGE #F7931A`, `PROB_BLUE #2B50E4`. Polymarket's:
`green-600 #34c759`, `red-600 #df0c10`, current-price `#ff9900`. No typography
scale is pinned to measured values.

**Gap 5 — missing affordances.** Dual Price-To-Beat / Current-Price header with
delta chip; per-digit odometer countdown synced to *server* time; wall-clock
time tabs; `Target` badge on the reference line; trade annotations on the plot;
one-tap buy with payout arithmetic; related-asset rail.

---

## 7. Reference figures to build against

```
window_seconds              300           (exact, wall-clock aligned)
twap_lookback_seconds       60
settlement                  close_twap >= open_twap  -> Up  (ties Up)
reference_price             twap(window_start)
settle_price                twap(window_end)
price_stream_hz             1             (whole-second timestamps)
price_precision             1e-18 fixed point (integer of record)
stream_delivery_lag         0.7 – 2.0 s
resolution_lag              ~53 s after window end
tick_size                   0.01, refining to 0.001 at the extremes
order_min_size              5 shares
fee                         rate 0.07, exponent 1, taker-only, rebate 0.2
display_price               2 dp, thousands-separated
display_countdown           MM / SS, per-digit, CLOB-server-synced
payout                      shares = stake / ask_price
complement_invariant        bid(UP) = 1 - ask(DOWN), exactly
```
