# Chart + hero capture, 2026-10-16

The evidence behind sections **K** and **L** of
[40-ELEMENT-MATRIX](../40-ELEMENT-MATRIX.md), and behind §2.9 and §2.11 of
[42-MATRIX-STATUS](../42-MATRIX-STATUS-2026-10.md).

`captures-v2/` covered pages. It never covered the chart as a **live object** —
the ticker that animates onto the plot, the crosshair, how many markets the
hero carries, what secondary content sits with it — so this is a separate,
narrower capture rather than an amendment to that one. `captures-v2/` stays
frozen: rewriting a measurement record falsifies what was measured.

Same rules as v2: no login, no forms submitted, no bot evasion, TLS
verification on, ≥3 s between navigations.

## Why re-measure at all

Because §3.4 of the status doc says to, and it was right. Between 2026-09-27
and 2026-10-16 **both** incumbents rebuilt the home hero into a split
panel + live chart + ranked rails, and **both** added an on-chart trade ticker
that does not appear anywhere in the September DOM. A competitor column read
from the September capture would have been three weeks wrong about the thing
this section is about.

## What is here

```
harness/
  capture.js   page + plot + floating-label probe; N frames, then hover at 30/60/88%
  ticker.js    ~120 ms in-page sampler for the trade ticker's lifecycle
  ours.js      our own hero, walked slide by slide: legend vs panel, rails, glyphs
  rails.js     resolved swatch colours, rail row counts, icon identity
  colormath.py sRGB -> Lab -> CIEDE2000 + the Viénot/Brettel dichromacy sim
  okabe*.py    the palette search: flatten (failed), shift (shipped), compare
  shot-ticker.js  drives the ticker from a stubbed trades route and shoots it
  shot-news.js    three frames of the news card, one rotation apart
  record-live.js  records the ticker against REAL seeded rows — no stub, so
                  what lands on screen came through the DB, the route and the
                  poller (pair it with scripts/seed_ticker_activity.py --live)
  pal6b.py     the from-scratch max-min search, kept because its result is the
               argument against doing it that way
data/
  ticker-lifecycle.json  249 samples over 45 s of polymarket.com's hero
shots/
  PM-*  polymarket.com     KA-*  demo.kalshi.co
  EL-*  ours, before       V-*, EL3-*  ours, after
  TICKER-market.png   our ticker, two trades in their own outcome colours
  TICKER-live.png     six, driven by real rows arriving while the page was open
  NEWS-rail.png       the rotating "In the news" card in the hero rail
```

## The three measurements worth keeping

**The trade ticker (K7).** `+ $<size>` labels, 13 px / weight 600, each in its
own outcome's series colour (`rgb(105,190,40)`, `rgb(39,151,255)`,
`rgb(255,127,14)`, `rgb(253,197,3)` observed in one 45 s window), inside a
`pointer-events-none absolute z-10 bottom-10 left-2.5` overlay anchored to the
bottom-left of the plot. New trades push the stack and it drifts. The same
component runs on mobile **cards**, where Polymarket's own `+ $100` lands on
top of the "Up" button.

**Their hover readout (K5).** No tooltip box anywhere. A thin crosshair, the
timestamp centred *above* the plot, each series' value painted inline on its
own line in its own colour, and everything after the crosshair ghosted to
grey. `PM-multi-desktop-hover-60.png` is the clearest frame.

**Their multi-outcome chart draws two lines (K6).** The Brazil event carries 32
markets. The chart draws Lula and Bolsonaro, labels both at their last point,
and runs no legend row at all. That is why their end-label geometry works and
would not work on ours.

## Reproducing

```
HTTPS_PROXY=$HTTPS_PROXY node harness/capture.js '[{"id":"PM-home","url":"https://polymarket.com/","vp":"desktop","frames":8}]' pm
NO_PROXY_LOCAL=1  node harness/capture.js '[{"id":"EL-home","url":"http://localhost:3000/","vp":"desktop","frames":2}]' el
python3 harness/okabe3.py      # the lightness-shift table the palette was chosen from
```

`capture.js` needs the sandbox Chromium at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; set `NO_PROXY_LOCAL=1`
for localhost or the agent proxy answers instead of the dev server.
