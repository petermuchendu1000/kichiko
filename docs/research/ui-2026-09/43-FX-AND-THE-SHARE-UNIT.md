# Where KSh 130 comes from, and what the share should settle in

2026-10-16. Opened because the market-page capture showed `Yes KSh 60 + No
KSh 70 = KSh 130` where Polymarket's two prices sum to ~100¢, and the comment
justifying it leans on a constant that `lib/currency.ts` explicitly refuses to
hold constant.

The conclusion is not the one the question implied. The display is fine; the
exposure underneath it is the finding.

---

## 1. Is 130 hardcoded?

No. It is `usdToLocal(1, 'KES', rates)` — that is, `1 / rate`. `getUsdRate()`
has exactly one precedence chain and the module forbids magic numbers at call
sites ("Call sites must NEVER invent magic-number fallbacks (e.g. `|| 0.01`)"):

1. live rate from `exchange_rates`
2. `FALLBACK_USD_RATES` ← `lib/generated/fx-fallback.json`
3. throw, only for an unknown currency code

The live row, read 2026-10-16:

| from | to | rate | units_per_usd | source | rate_date | fetched_at |
|---|---|---|---|---|---|---|
| KES | USD | 0.00770357 | **129.81** | `cbk` | 2026-10-15 | **2026-10-16 04:58** |

Under two hours old. "130" is `round(129.81)` and nothing more.

## 2. Is it dynamic and real-time?

Yes, and the pipeline is better than the first pass credited. Four sources
fetched in parallel → `fx_observations` → range-checked against `fx_bands` →
upserted into `exchange_rates`. KES carries **two independent accepted
sources**:

| source | obs | span | low | high | range | σ | official |
|---|---|---|---|---|---|---|---|
| `cbk` | 61 | 20 days | 129.620 | 129.940 | **0.247%** | 0.095 | yes |
| `fawazahmed0` | 64 | 20 days | 128.420 | 129.906 | 1.157% | 0.425 | no |

### Three gaps worth closing

1. **`fx-fallback.json` is 80 days stale** — generated `2026-07-28`, implying
   129.49 against today's 129.81. Only 0.25% off, so harmless *now*; it rots
   silently and nothing gates it. `scripts/ops/refresh_fx_fallback.py` exists
   and is not scheduled.
2. **`fx_bands` covers KES and UGX only.** TZS, RWF, ZMW, ETB and BIF have no
   sanity range, so a poisoned quote for those is accepted unchecked. ETB is
   currently live at 160.92 from a *single* source (`nbe`) with nothing
   validating it.
3. **`job_runs` is empty.** The FX cron plainly runs — the data is two hours
   old — but records no run history, so a silent failure stays invisible until
   someone notices the rate has stopped moving.

## 3. Free sources — four already wired, all verified reachable 2026-10-16

| source | result | note |
|---|---|---|
| CBK `centralbank.go.ke` (admin-ajax, POST) | 200, 8.7 s | the official Kenyan quote; flagged `official` |
| `cdn.jsdelivr.net/npm/@fawazahmed0/currency-api` | 200, 0.13 s | → 129.796, dated 2026-10-15 |
| `latest.currency-api.pages.dev` (mirror) | 200, 0.22 s | → **129.830, dated 2026-10-16** |
| `fxrates.bnr.rw` | 404 on a hand-built URL | serves RWF, not KES |

All keyless. Note the Cloudflare mirror was **fresher than CBK** on the day
measured — worth preferring for recency while CBK stays the official anchor.

## 4. Three claims from the first pass that the data refuted

Recorded because the method is the point: each was stated before it was
measured, and each was wrong.

- **"Only one FX observation is stored."** No — 125 KES observations. The
  first query filtered on a column that does not exist, and the error was read
  as a finding.
- **"`34 + 96 = KSh 130` stops being true tomorrow."** Tested across rates
  128 → 162 on two real option prices: the invariant holds in **23 of 24**
  cases. Rounding two complements half-up almost always sums to the rounded
  total; it breaks only at edges (128.50 against a 23.8% outcome).
- **"An unchanged market shows a drifting price."** Measured drift is 0.247%
  over 20 days. On a KSh 60 price that is ±KSh 0.15 — **smaller than the
  KSh 1 the display already rounds to.** The number on screen would not
  change.

A fourth, chased and also clean: `localToUsd` rounds to cents, so KSh 20 →
$0.15 → KSh 19.47 (−2.65%). It never happens. The order route passes
`p_amount_local` straight to Postgres, which does `v_amt_usd := p_amount_local
* v_rate` at **full numeric precision** (110_play_limits.sql:689), and the
smallest real deposit is **KSh 4,210** (median KSh 130,112), where the error
is 0.0004%.

## 5. What survives: the exposure, which volatility does not govern

- `wallets.currency` is **KES** — 74 wallets, KSh 34,971,283 available,
  KSh 193,126,738 deposited.
- `positions` are **USD** — $1,602,353 open.

The platform takes shillings, holds dollar-denominated obligations, and pays
shillings. **The whole open book is unhedged KES/USD basis.**

| KES/USD | shilling cost of the same open book |
|---|---|
| 129.81 (today) | KSh 208,001,480 |
| 162.00 (where the shilling sat in 2024) | KSh 259,581,232 |

**KSh 51.6M (+24.8%) with no change in anybody's prediction.** The figures are
seeded data, so the absolute number is not a real liability — the ratio is,
and it does not depend on the shilling being volatile this month.

## 6. The correct peg value

**KSh 100 per share, if we peg.**

1. It is the only value for which price-in-KSh ≡ probability-in-%. That
   identity is the whole reason Polymarket's ¢ convention reads cleanly —
   $1 = 100¢ — and settling at $1 ≈ KSh 130 is exactly what costs us it. Our
   own board prints `46%` and `KSh 60` for one quantity, which is the
   confusion the capture started from.
2. It denominates obligations in KES, matching KES deposits. The exposure in
   §5 goes to zero without a hedging desk.
3. The KSh 20 statutory minimum still works: 0.2 shares against a KSh 100
   ceiling.

**What it costs:** a KES-denominated book cannot pool liquidity with a USD
book. If the US entity is to share order flow with the Kenyan one, $1 is the
right unit and §5 needs a real hedge instead.

So the question is not which number reads better. It is **where reserves sit,
and whether the two entities share a book** — treasury and corporate
structure, not UI. Both sides are priced above; the call is the owner's.
