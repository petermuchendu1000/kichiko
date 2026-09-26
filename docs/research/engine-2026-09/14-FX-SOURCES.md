# 14 — Official, free FX sources for KES, UGX, TZS, RWF, ZMW, ETB, BIF (to USD)

Date: 2026-09-26. Scope: find the most official free daily sources, check that they work, design validation, audit the repo's FX path, and plan the integration.
Labels used below: **VERIFIED-LIVE** means fetched from this sandbox today. **RECORDED** means a real HTTP response captured by a third party (a date is always given). **BLOCKED-BY-SANDBOX** means the egress proxy refused it. **UNVERIFIED** means I could not confirm it. **INFERENCE** means my own reasoning.

---

## 0. TL;DR

1. **The sandbox blocked every central bank host and every FX API host.** The egress proxy returned `403` on CONNECT for www.centralbank.go.ke, www.bou.or.ug, www.bot.go.tz, www.bnr.rw, www.boz.zm, nbe.gov.et, www.brb.bi, open.er-api.com, cdn.jsdelivr.net, currency-api.pages.dev, api.frankfurter.app/.dev, openexchangerates.org, api.exchangerate.host, api.worldbank.org, data.imf.org and ecb.europa.eu. WebFetch returned `EGRESS_BLOCKED` for the same hosts. The proxy status endpoint logged each denial. **So no central-bank endpoint could be checked live today.** Each one needs a one-command check from a production network (§9, step 0).
2. **One live check did succeed.** The fawazahmed0 `currency-api` dataset is also published daily to the **npm registry**, which the sandbox can reach. I downloaded the `2026.9.26` tarball and 209 daily snapshots (2026-03-01 → 2026-09-26). That gives real current values and real volatility statistics (§4).
3. **I did not guess the central-bank endpoints.** They come from source code: the open-source **Frankfurter** project (`lineofflight/frankfurter`, MIT) runs production adapters for CBK, BoT, BNR (Rwanda), BoZ, NBE and BRB. Its VCR cassettes hold **real recorded responses** from 2026-03 to 2026-09 (§2).
4. **How machine-readable each bank is:**
   - **BNR (Rwanda)** has a real public JSON API (`fxrates.bnr.rw`) that is designed for integration.
   - **NBE (Ethiopia)** has a JSON API (`api.nbe.gov.et`).
   - **CBK (Kenya)** has a stable JSON endpoint behind its WordPress table (`admin-ajax.php … table_id=193`).
   - **BoZ (Zambia)** has Drupal JSON:API metadata that points to a daily XLSX file.
   - **BoT (Tanzania)** only has an HTML form with an anti-forgery token, and Frankfurter's code comments call it flaky.
   - **BRB (Burundi)** publishes one PDF per business day.
   - **BoU (Uganda):** I found no machine-readable daily endpoint (UNVERIFIED). The only known file is an XLSX series. Third parties report that the site needs JavaScript.
   - None of these banks publishes API terms of use that I could find (`terms_url: null` in Frankfurter's metadata, except BNR).
5. **Recommendation:**
   - **(a) Ingestion layer:** use official central-bank observations with provenance through **Frankfurter v2** (`/v2/rates?base=USD&quotes=…&expand=providers`). Self-host the Docker image if the fair-use limits or availability are a concern. Do not write and maintain 7 scrapers.
   - **(b) Independent second source:** fawazahmed0 (CC0, three mirrors).
   - **(c) Third, tie-break source:** the existing ExchangeRate-API open endpoint. It needs visible attribution, which Kichiko does not show today.
   - Add sanity bands, a daily-move gate, a cross-source deviation gate and a staleness gate, all enforced in SQL (§6).
6. **Why FX is stale (last KES fetch 2026-07-28):**
   - Nothing in the repo schedules the cron.
   - `vercel.json` has no `crons`.
   - `fly.toml` has no scheduled machine.
   - No GitHub workflow calls `/api/cron/*`.
   - The pg_cron jobs exist only if an operator ran `schedule_kichiko_jobs(url, secret)` by hand.
   - The 2026-07-28 timestamp equals the day migration 067 was committed (`3476616`, 2026-07-28 14:20 UTC), and 067 sets `fetched_at = now()`. That is consistent with the cron never having written a row since (INFERENCE; §7.3).
7. **A labelling bug found on the way:** the admin deposits and withdrawals pages define a local `kes()` that just prefixes "KSh" (`deposits/page.tsx:26-28`, `withdrawals/page.tsx:26-28`, comment "stored natively in KES"). Deposits and withdrawals are stored in the wallet's own currency (`001:400-401`), so a UGX 100,000 withdrawal is shown as "KSh 100,000" (§7.4, H1–H2).

---

## 1. What I actually reached

| Host | Method | Result |
|---|---|---|
| registry.npmjs.org (`@fawazahmed0/currency-api`) | curl | **200**, VERIFIED-LIVE. 209 daily tarballs downloaded |
| raw.githubusercontent.com (Frankfurter and fawazahmed0 source, cassettes, OpenAPI) | curl | 200 |
| GitHub code search (MCP) | tool | worked |
| WebSearch | tool | worked; snippets only, cited as such |
| All 7 central banks, open.er-api.com, jsDelivr, currency-api.pages.dev, Frankfurter API, OXR, exchangerate.host, IMF, World Bank, ECB, apify.com, allratestoday.com, opendataforafrica.org | curl and WebFetch | **BLOCKED-BY-SANDBOX** (proxy `403` on CONNECT / `EGRESS_BLOCKED`) |

Proxy evidence comes from `curl $HTTPS_PROXY/__agentproxy/status` → `recentRelayFailures`: `www.centralbank.go.ke:443 gateway answered 403 to CONNECT`, and the same entry for each host above, at 2026-09-26T13:32Z.

---

## 2. The seven issuing central banks

Common background: Frankfurter keeps one adapter per provider under `lib/provider/adapters/*.rb` and provider metadata under `db/seeds/providers/*.json`. The metadata fields are `data_url`, `terms_url`, `publish_schedule` and `rate_type`. Its scheduler runs in UTC ("Re-blend the trailing window at UTC midnight", `bin/schedule`), so the `publish_schedule` crons are most likely UTC (INFERENCE).

Source: https://github.com/lineofflight/frankfurter (fetched through raw.githubusercontent.com, `main`, 2026-09-26).

### 2.1 Central Bank of Kenya (CBK) → KES

- **Machine-readable:** yes, undocumented but stable. It is the WordPress **wpDataTables** AJAX backend behind https://www.centralbank.go.ke/rates/forex-exchange-rates/.
- **Endpoint:** `POST https://www.centralbank.go.ke/wp-admin/admin-ajax.php?action=get_wdtable&table_id=193`
  - Form body: `draw=1&start=0&length=-1` (returns everything).
  - Table 32 holds 2003–2024. Table 193 holds 2024-01-05 onward (Frankfurter `cbk.rb`).
  - Several independent projects use the same endpoint:
    - `williamluke4/erpnext_cbk_exchange_rate/…/fetch.py` (table 193, with column filter `US DOLLAR`, `order[0][dir]=desc`, `length=1`)
    - `peregin/exchange-rate-service` README
    - `plugintheworld/historic_bank_rates` (table 32)
- **Response (RECORDED 2026-03-23 00:06 GMT, Frankfurter `spec/vcr_cassettes/cbk.yml`):**
  ```json
  {"draw":1,"recordsTotal":"11550","recordsFiltered":"11550","data":[["05\/01\/2024","US DOLLAR","157.9012"], …,
   ["19\/03\/2026","US DOLLAR","129.5200"],["19\/03\/2026","KES \/ USHS","29.0900"],["19\/03\/2026","KES \/ TSHS","20.1100"],
   ["19\/03\/2026","KES \/ RWF","11.2600"],["19\/03\/2026","KES \/ BIF","22.9200"], …]}
  ```
  - Header: `Content-Type: text/html; charset=UTF-8`, even though the body is JSON. Parse the body, not the header.
- **Fields:** each row is `[date dd/mm/yyyy, currency label, mean]`, three columns. Table 193 has only the mean, no buy or sell.
  - Most rows are **KES per 1 foreign unit**.
  - The East African rows `KES / USHS`, `KES / TSHS`, `KES / RWF` and `KES / BIF` are **foreign units per 1 KES**. Frankfurter's comment: "Cross-rate rows are published foreign-per-KES".
  - Labels such as `JPY (100)` mean a quote per 100 units.
- **Semantics:** CBK says the rates "reflect the average buying and selling rates of the major participants in the foreign exchange market at the open of trade every day" (WebSearch snippet of the CBK forex page; UNVERIFIED verbatim).
- **Timing:** business days only. Frankfurter polls `*/30 8-10 * * 1-5`, i.e. 11:00–13:30 EAT if UTC (INFERENCE).
- **Terms:** no API terms. The site footer reads "Copyright … Central Bank of Kenya. All rights reserved." (WebSearch snippet, UNVERIFIED verbatim). Frankfurter `terms_url: null`.
- **Live check:** BLOCKED-BY-SANDBOX.
- **Bonus:** CBK's cross rates give official, daily, machine-readable proxies for **UGX, TZS, RWF and BIF**, e.g. `UGX per USD = USD_mean × (KES/USHS)`. Precision is limited because the cross rows have 4 significant digits (`29.09` → ±0.017% quantisation).

### 2.2 Bank of Uganda (BoU) → UGX

- **Machine-readable daily:** **not found (UNVERIFIED).**
  - Rates page: https://www.bou.or.ug/interest_rates_exchange_rates (WebSearch).
  - A WebSearch snippet says BoU publishes "a daily opening rate card each morning — middle, buying and selling shilling rates … plus a COMESA table". The snippet came from a third-party page, allratestoday.com, which was BLOCKED.
  - Known file: `https://www.bou.or.ug/bou/bouwebsite/bouwebsitecontent/statistics/Exchange_Rates/Exchange-Rates.xlsx`. It is used by `SebKrantz/shiny-data-portal/get_data.R` with the comment "Daily buying, selling and mid exchange rates". A WebSearch snippet instead describes it as "monthly … January 2005 to February 2026". The frequency is UNVERIFIED.
  - A third-party codebase notes "BOU : bou.or.ug nécessite JavaScript" (`projet224solutions-afk/vista-flows/backend/src/services/fxRates.service.ts`).
- **Frankfurter has no BoU adapter.**
- **Official alternatives that are machine-readable:** the CBK cross (§2.1), the BNR `currency_name=UGX` series (§2.4), and the BRB PDF "Shilling Ougandais" row (§2.7). The Uganda Revenue Authority also publishes rates at https://ura.go.ug/en/exchange-rates/ (WebSearch; format UNVERIFIED).
- **Live check:** BLOCKED-BY-SANDBOX.

### 2.3 Bank of Tanzania (BoT) → TZS

- **Machine-readable:** HTML only.
  - Current table: https://www.bot.go.tz/ExchangeRate/excRates.
  - History: `https://www.bot.go.tz/ExchangeRate/previous_rates`, reached by GET followed by POST.
  - The POST must carry the ASP.NET MVC `__RequestVerificationToken` both as a cookie and as a form field, or the server returns HTTP 500 (Frankfurter `bota.rb`).
  - Form fields: `dateFrom=MM/DD/YYYY`, `dateTo=MM/DD/YYYY`.
  - Frankfurter's comment: "a demonstrably flaky endpoint".
- **Fields:** the table header is `S/N | Currency | Buy | Sell | Mean | Date`, with `Date` like `19-May-26`. Use **Mean**. Strip `,` separators.
- **Cassette caveat:** the recorded cassette (2026-05-19) shows `USD | 2,589.0,500 | 2,615.0,600 | 2,602.0,545`. This looks like a sanitised fixture (the HTML is minimal), so I treat its numbers as not real.
- **Timing:** Frankfurter metadata says "Publishes 7 days a week", polled at `*/30 8-10 * * *`.
- **Terms:** none found.
- **Live check:** BLOCKED-BY-SANDBOX.

### 2.4 National Bank of Rwanda (BNR) → RWF — the best official API of the seven

- **Machine-readable:** yes, and this is the only one that is explicitly an **API for integration**: "BNR Exchange rate API … designed for integrating the National Bank of Rwanda's Exchange Rate with systems through API" (https://fxrates.bnr.rw/, WebSearch snippet).
- **Endpoint:** `GET https://fxrates.bnr.rw/currency_history/?currency_name=USD&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`. It serves one currency per request.
- **Response (RECORDED 2026-05-24 06:42 GMT, `application/json`):**
  ```json
  [{"currency_name":"USD","buying_rate":"1458.3525","average_rate":"1463.3525","selling_rate":"1468.3525","post_date":"22-May-26"}, …]
  ```
- **Parsing:**
  - All values are strings.
  - Older values can contain thousands commas (`"1,253.60"`), so strip `,`.
  - Parse `post_date` as `%d-%b-%y`.
  - Array order is **not** chronological; the recording returns 19, 21, 22, 20. Sort by date.
  - Use `average_rate`.
- **Coverage:** also serves `KES`, `UGX`, `TZS` and `BIF` (Frankfurter `CURRENCIES`, "Verified live 2026-05-24"). That makes it a second official source for UGX, TZS and BIF.
- **Timing:** Frankfurter polls `*/30 14-16 * * 1-5` (17:00–19:00 Kigali if UTC; INFERENCE).
- **Terms:** Frankfurter lists `terms_url: https://www.bnr.rw/statuse`, which I could not fetch.
- **Live check:** BLOCKED-BY-SANDBOX.

### 2.5 Bank of Zambia (BoZ) → ZMW

- **Machine-readable:** in two steps.
  1. Call the Drupal JSON:API: `GET https://www.boz.zm/jsonapi/node/historical_average_exchange_rate?include=field_average_historical_file&sort=-created&page[limit]=1`.
  2. Follow `included[].attributes.uri.url` to the current XLSX. The filename changes every day (`/sites/default/files/2026-09/AVERAGE_FXRATES_3.xlsx`).
- **Workbook layout:** one sheet.
  - Row 3 is a banner: `Dollar | Pound | Euro | Rand`.
  - Then a `DATE | Buy | Sale …` header row.
  - Each data row holds an Excel serial date in column B, then a buy/sale pair per currency. Hidden rows are skipped.
  - Values before 2013 are old kwacha (ZMK).
- **Response (RECORDED 2026-09-09 12:51 GMT):**
  - The JSON:API node is `"title":"HISTORICAL AVERAGE EXCHANGE RATES SERIES 8926","created":"2026-09-08T14:27:26+00:00"`.
  - The last XLSX row is `B=46273` (= **2026-09-08**), `C=19.2041` (USD buy), `D=19.2541` (USD sale). **Mid = 19.2291 ZMW/USD.**
- **Also available:** "an intraday USD/ZMW view (three fixes per day since 2026-01) at `/api/v1/views/boz_zmw_usd_daily_exchange_rates`" (Frankfurter `boz.rb` comment). Its shape is UNVERIFIED. It is a better fit for a live product rate if it proves stable.
- **Timing:** new node created about 14:27 UTC on business days; Frankfurter polls `*/30 14-16 * * 1-5`.
- **Terms:** none found.
- **Live check:** BLOCKED-BY-SANDBOX.

### 2.6 National Bank of Ethiopia (NBE) → ETB

- **Machine-readable:** yes, JSON. `GET https://api.nbe.gov.et/api/filter-exchange-rates?date=YYYY-MM-DD` (Frankfurter `nbe.rb`).
- **Response (RECORDED 2026-05-22 12:50 GMT, `application/json`, `Cache-Control: no-cache, private`):**
  ```json
  {"success":true,"message":"OK","status":200,"data":[ … {"buying":"157.227","selling":"158.7993","date":"2026-05-18",
   "weighted_average":"157.227","currency":{"name":"US DOLLAR","code":"USD"}} … ]}
  ```
- **Fields:** `currency.code`, `buying`, `selling`, `weighted_average`, `date`.
- **Semantics:** "The weighted average exchange rate is computed from all banks' FX transactions on the **prior business day**" (WebSearch snippet of nbe.gov.et). So the quote lags by one business day.
- **Quirk (INFERENCE):** in the recording, `weighted_average == buying` for USD on 2026-05-18, so do not assume the value sits halfway between buy and sell.
- **Coverage:** Frankfurter coverage starts 2024-10-01 "to skip the July to September 2024 float-transition gap". That is the regime change that made ETB move by double digits (see https://en.wikipedia.org/wiki/2024_Ethiopian_foreign_exchange_rate_policy; magnitude UNVERIFIED here).
- **Timing:** weekdays; Frankfurter polls `*/30 10-12 * * 1-5`.
- **Terms:** none found.
- **Live check:** BLOCKED-BY-SANDBOX.

### 2.7 Banque de la République du Burundi (BRB) → BIF

- **Machine-readable:** no, PDF only.
  - The index is at `https://www.brb.bi/en/affichagetoustauxchange` (paginated Drupal).
  - Each business day has one PDF: `/sites/default/files/YYYY-MM/Cours%20de%20change%20du%20DD-MM-YYYY.pdf` (about 220 KB).
  - Each PDF has columns Acheteur, Cours moyen jour and Vendeur. Frankfurter keeps the **mid** (`brb.rb`).
- **Row format:** Frankfurter's regex is `/\A1\s+(.+?)\*?\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)\s*\z/`, and the decimal separator is `,`.
- **Labels:**
  - `Dollar USA`, `Shilling Kenyan`, `Shilling Tanzanien`, `Shilling Ougandais`, `Franc Rwandais` …
  - `DTS` = XDR.
  - A trailing `*` means "not accepted by manual exchange bureaus" and should be stripped.
- **TLS quirk:** "www.brb.bi omits its RapidSSL intermediate" (Frankfurter `brb.rb`). A Node `fetch` will fail certificate validation unless the intermediate is bundled.
- **Recorded:** the index (2026-05-24) listed PDFs for 22-05, 20-05 and 19-05-2026, and two PDFs were recorded. I could not extract their numbers because the local PDF libraries failed.
- **Timing:** Frankfurter polls `*/30 7-9 * * 1-5`.
- **Terms:** none found.
- **Live check:** BLOCKED-BY-SANDBOX.

### 2.8 Summary

| Ccy | Issuer | Machine-readable? | Endpoint | Field to use | Cadence | Live today |
|---|---|---|---|---|---|---|
| KES | CBK | JSON (undocumented) | `POST …/admin-ajax.php?action=get_wdtable&table_id=193` | row[2] mean, `US DOLLAR` | business days, morning | BLOCKED |
| UGX | BoU | **no daily API found** | `…/Exchange_Rates/Exchange-Rates.xlsx` (frequency UNVERIFIED) | — | — | BLOCKED |
| TZS | BoT | HTML form + CSRF token | `POST /ExchangeRate/previous_rates` | Mean | 7 days | BLOCKED |
| RWF | BNR | **JSON API, intended for integration** | `GET fxrates.bnr.rw/currency_history/?currency_name=USD&start_date&end_date` | `average_rate` | business days, afternoon | BLOCKED |
| ZMW | BoZ | JSON:API → XLSX | `/jsonapi/node/historical_average_exchange_rate?…` → XLSX | mid(Buy, Sale) | business days, about 14:30 UTC | BLOCKED |
| ETB | NBE | JSON | `GET api.nbe.gov.et/api/filter-exchange-rates?date=` | `weighted_average` (previous day) | weekdays | BLOCKED |
| BIF | BRB | PDF | index → daily PDF | Cours moyen | business days, morning | BLOCKED |

---

## 3. Aggregators, used as fallbacks

| Source | Covers all 7? | Upstream | Update | Limits / key | Terms | Live today |
|---|---|---|---|---|---|---|
| **Frankfurter v2** (`https://api.frankfurter.dev/v2`) | yes, via CBK/BNR/BoZ/NBE/BRB/BoT (+ IMF) | **the central banks themselves**, blended ("rebase to USD pivot → Consensus outlier screen → recency-decay WeightedAverage → PegAnchor", `AGENTS.md`) | per provider schedule; blends re-computed at 00:00 UTC | no key; "no quotas… rate-limited to prevent abuse… soft fair-use limits" (WebSearch snippet of frankfurter.dev) | MIT code; self-hostable Docker `lineofflight/frankfurter` | BLOCKED |
| **fawazahmed0 currency-api** | yes | **undisclosed**: `currscript.js` fetches `process.env.currlink` (EUR-base JSON) plus a Playwright-scraped page (`currlink3`), both GitHub secrets | daily. The workflow cron is `0 0 * * *`; npm publish times observed at 04:14–04:30 UTC (2026-09-22…26) | none ("No Rate limits", README) | **CC0 1.0** (`LICENSE`) | **VERIFIED-LIVE via npm** |
| **ExchangeRate-API open** (`open.er-api.com/v6/latest/USD`, used today) | yes (repo fallback JSON has all 7) | "a large number of central banks … plus commercial marketplaces… 30+ sources… blend… supports a currency only with ≥3 sources" (WebSearch snippet of /product/our-exchange-rate-data) | once per day | rate-limited if polled more than about once per 24 h; 20-minute lockout (WebSearch snippet of /docs/free) | **attribution required**; caching allowed; **no redistribution** (same snippet) | BLOCKED |
| Open Exchange Rates free | yes (UNVERIFIED per currency) | undisclosed | hourly | app id; **1,000 req/month**; base USD only | commercial ToS | BLOCKED |
| exchangerate.host | UNVERIFIED | APILayer | — | **API key now required**; free tier 1,000 req/month (WebSearch snippets) | commercial | BLOCKED |
| IMF representative rates `rms_mth.aspx?…&tsvflag=Y` | **no**: the recorded March-2026 file has 85 lines and none of the 7 currencies, even though `imf.rb` maps UGX/RWF/ZMW | member central banks | daily, published monthly | none | IMF copyright terms | BLOCKED |
| World Bank `PA.NUS.FCRF` | annual averages only, not daily | — | annual | — | CC BY 4.0 (UNVERIFIED) | BLOCKED |
| ECB / Frankfurter v1 | **no**: the ECB reference list has none of the 7 | ECB | daily | — | — | BLOCKED |

**fawazahmed0 URL patterns** (README, fetched): `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{latest|YYYY-MM-DD}/v1/currencies/usd.json`, with a fallback at `https://{latest|YYYY-MM-DD}.currency-api.pages.dev/v1/currencies/usd.json`.

- The README warns: "Please include Fallback mechanism … if `cdn.jsdelivr.net` link fails, fetch from `currency-api.pages.dev`".
- A third, very robust mirror is the npm tarball itself: `https://registry.npmjs.org/@fawazahmed0/currency-api/-/currency-api-YYYY.M.D.tgz` → `package/v1/currencies/usd.min.json`.
- Observed gaps: no `2025-12-10` and no `2026-08-19` dist-tags, so a day can be missed.

---

## 4. Measured data

### 4.1 Live sample (VERIFIED-LIVE, npm `@fawazahmed0/currency-api@2026.9.26`, published 2026-09-26T04:30:42Z)

```
{"date":"2026-09-26","usd":{"kes":129.57999255,"ugx":3915.19608588,"tzs":2647.19784399,"rwf":1475.10472877,
 "zmw":19.50046479,"etb":161.98008041,"bif":2997.48984648, … "eur":0.87786534}}
```

### 4.2 The repo's fallback file is stale by up to 5.9%

`apps/web/lib/generated/fx-fallback.json` is dated 2026-07-28 and sourced from ExchangeRate-API. Converted to units per USD and compared with today's value:

| Ccy | fallback (per USD) | 2026-09-26 (fawazahmed0) | drift |
|---|---|---|---|
| KES | 129.4897 | 129.5800 | +0.07% |
| UGX | 3696.169 | 3915.196 | **+5.93%** |
| TZS | 2630.258 | 2647.198 | +0.64% |
| RWF | 1473.249 | 1475.105 | +0.13% |
| ZMW | 18.7006 | 19.5005 | **+4.28%** |
| ETB | 160.110 | 161.980 | +1.17% |
| BIF | 2993.720 | 2997.490 | +0.13% |

On 2026-07-28 itself, ExchangeRate-API said UGX = 3696.17 while fawazahmed0 said 3765.00. That is a **1.8% disagreement between two aggregators on the same day**. It shows why one source alone is not enough.

### 4.3 Day-over-day moves in the aggregator (209 snapshots, 2026-03-01 → 2026-09-26, |log return|)

| Ccy | p50 | p99 | max | >2% days |
|---|---|---|---|---|
| KES | 0.039% | 0.53% | 0.92% | 0 |
| UGX | 0.157% | 1.57% | 2.56% | 1 (2026-03-04) |
| TZS | 0.157% | 0.74% | 1.04% | 0 |
| RWF | 0.117% | 0.84% | 1.06% | 0 |
| ZMW | 0.246% | 1.92% | 3.13% | 1 (2026-03-25) |
| ETB | 0.327% | 1.66% | 2.26% | 1 (2026-08-31) |
| BIF | 0.115% | 1.42% | 1.70% | 0 |

Note (INFERENCE): the aggregator's KES noise (p50 0.04%) is **larger** than CBK's own day-to-day change (p50 0.015%, below). Blended aggregators add noise to managed currencies.

### 4.4 Official daily moves (CBK table 193, RECORDED, 549 business days, 2024-01-05 → 2026-03-19; UGX/TZS/RWF/BIF via CBK cross)

| Ccy | p50 | p99 | max (date) | longest gap |
|---|---|---|---|---|
| KES | 0.015% | 1.25% | **4.92%** (2024-02-16: 153.20 → 145.86) | 5 days |
| UGX | 0.129% | 1.59% | 2.33% (2026-03-04) | 5 days |
| TZS | 0.199% | 2.44% | 4.32% (2024-12-11) | 5 days |
| RWF | 0.054% | 2.18% | 3.63% (2024-12-06) | 5 days |
| BIF | 0.007% | 0.46% | 1.64% (2024-10-11) | 5 days |

KES alone fell from 160.57 to 132.92 between 2024-02-02 and 2024-03-22. Real, legitimate moves of about 5% in one day happen, so a hard 2% cap would have frozen the platform on a true move.

### 4.5 Official vs aggregator, same day (|deviation|, official recording vs fawazahmed0 snapshot of the same date)

| Official source | Ccy | n | mean | max |
|---|---|---|---|---|
| BNR `average_rate` (2026-05-19..22) | RWF | 4 | 0.04% | 0.07% |
| CBK mean (2026-03-06..19) | KES | 10 | 0.17% | 0.45% |
| CBK cross | UGX | 10 | 0.21% | 0.47% |
| CBK cross | TZS | 10 | 0.22% | 0.49% |
| CBK cross | RWF | 10 | 0.17% | 0.41% |
| CBK cross | BIF | 10 | 0.16% | 0.48% |
| NBE `weighted_average` (2026-05-18..20) | ETB | 3 | 0.46% | 0.75% |
| BoZ mid (2026-09-08) | ZMW | 1 | 0.11% | 0.11% |

With a one-day date misalignment the UGX maximum rises to 1.64%. **So agreement within 1% is normal, and more than 2% means one source is wrong or the dates are misaligned.**

---

## 5. Recommended source hierarchy

**Principle:** the canonical rate is the **issuing central bank's** rate when it is available and fresh. The second official source is another East African central bank's cross rate. The aggregator is used for cross-checks and gap-filling, and never as the only source for money movement.

| Ccy | P1, official primary | P2, official secondary | P3, aggregator check | Note |
|---|---|---|---|---|
| KES | CBK table 193 `US DOLLAR` mean | BNR `currency_name=KES` → KES/USD = USD_RWF / KES_RWF | fawazahmed0 `kes` | — |
| UGX | *(BoU: no API)* **CBK cross** `USD × KES/USHS` | BNR `UGX` cross | fawazahmed0 `ugx` | Use the median of P1, P2, P3; BoU XLSX for monthly reconciliation |
| TZS | BoT `previous_rates` Mean | CBK cross `KES/TSHS` | fawazahmed0 `tzs` | BoT is flaky, so auto-degrade to P2 |
| RWF | **BNR `average_rate`** | CBK cross `KES/RWF` | fawazahmed0 `rwf` | Best-documented official API |
| ZMW | BoZ XLSX mid (or intraday view, UNVERIFIED) | — | fawazahmed0 `zmw` | Only one official source, so P3 carries more weight |
| ETB | NBE `weighted_average` (previous day) | — | fawazahmed0 `etb` | Regime-change risk: gate hard on >10% moves |
| BIF | BRB PDF Cours moyen | CBK cross `KES/BIF`, BNR `BIF` | fawazahmed0 `bif` | The PDF is fragile; the P2 JSON sources are the practical operational primary |

**Build vs reuse (INFERENCE, recommended):**

- Do **not** write 7 scrapers.
- Call Frankfurter v2 per provider, e.g. `GET /v2/rates?base=USD&quotes=KES,UGX,TZS,RWF,ZMW,ETB,BIF&expand=providers`, or `GET /v2/providers/{CBK|BNRRW|BOZ|NBE|BRB|BOTA}/rate/USD/{CCY}`.
  - `expand=providers` returns `[{key, date, rate, excluded?}]` per record (OpenAPI 2.1.1, `lib/public/v2/openapi.json`). That is the provenance needed for audit.
  - The providers' anti-CSRF, PDF, XLSX and TLS quirks are then maintained upstream.
- For independence from a free public host, **self-host** `lineofflight/frankfurter` (Docker, SQLite, no API keys needed for these seven providers) on the existing Fly org.
- Keep fawazahmed0 as the independent P3. ExchangeRate-API remains an optional P4, and only if attribution is added.

---

## 6. Validation design

State per currency lives in `exchange_rates`. Every raw observation lands in a new append-only `fx_observations` table.

1. **Parse gates, per source.** A value must be finite and > 0, and its date must parse.
   - Rebase units for CBK `(100)` labels and the BoT `per 100` rows.
   - Invert cross rows (CBK `KES / X` means X per KES).
   - Convert everything to **units per USD** before any comparison.
2. **Static sanity band**, a hard reject that is reviewed quarterly. INFERENCE: about ±25% around the 2024–2026 observed ranges.
   - KES [100, 180]
   - UGX [3000, 5000]
   - TZS [2000, 3500]
   - RWF [1200, 2000]
   - ZMW [12, 35]
   - ETB [100, 300]
   - BIF [2500, 4500]

   A value outside its band is rejected with an alert. Widening a band needs a migration, which gives a human sign-off.
3. **Daily move gate** against the last accepted value, as |log change|:
   - Up to 3%: auto-accept. That covers the aggregator p99 of 0.5–1.9% and the official p99 of 0.5–2.4%.
   - 3–10%: accept only if **two independent sources** agree within 1%. The 2024-02-16 KES −4.9% move would have passed if CBK and a second source agreed.
   - Over 10%: quarantine. Keep the last good value, raise an alert, and require an admin to confirm. This covers the ETB 2024 float and the ZMK→ZMW style of change.
4. **Cross-source gate:** compare the official primary with the aggregator using **the same value date**.
   - Deviation up to 1%: OK.
   - 1–2%: warn and use the median of all sources present.
   - Over 2%: hold the last good value and alert.

   Measured normal: under 0.75% same-day, and 1.64% with a one-day skew (§4.5).
5. **Staleness gate.**
   - Official sources publish on business days, and the observed gap reaches 5 calendar days (Easter).
   - fawazahmed0 publishes daily at about 04:30 UTC but misses days.
   - Store `rate_date` (the publisher's value date) separately from `fetched_at`.

   Rules:
   - `age = now() − rate_date`.
   - Over 72 h: `/api/health` reports degraded and admins get an alert.
   - Over 120 h: money-moving RPCs for that currency are blocked, as are `clob_place_order` with `p_currency` and withdrawal quotes (RAISE `fx_stale`). This follows the "fail closed on money" pattern already used for `CRON_SECRET`.

   The two runtime thresholds (72 h, 120 h) should be configurable in `platform_settings`.
6. **Enforce in SQL, not only in TypeScript.** `upsert_exchange_rates` becomes `upsert_exchange_rates_v2(p_rows jsonb, p_force boolean default false)`.
   - Each row carries `{currency, units_per_usd, rate_date, source, sources_agreeing}`.
   - The function re-checks bands 2–3 against the stored row. `p_force` is only permitted when called with an admin-audited context.
   - This closes audit finding 6.28 (no bounds) at the database, the last line of defence.
7. **Storage precision.** `exchange_rates.rate DECIMAL(20,8)` stores USD per unit.
   - For UGX, 1/3915.196 = 0.000255415… is stored as 0.00025542, a relative error of **1.9e-5**. TZS is 5.5e-6 and BIF 7.4e-6 (computed).
   - Store the published quote `units_per_usd NUMERIC(20,8)` as the canonical value. Derive `rate` from it, or widen to `NUMERIC(24,14)`.

---

## 7. How the repo handles FX today

### 7.1 Flow

- **Fetch:** `apps/web/lib/integrations/fx.ts`.
  - If `OPENEXCHANGERATES_APP_ID` is set, it calls OXR `latest.json` (`fx.ts:36,124-129,151-159`).
  - Otherwise it calls `open.er-api.com/v6/latest/USD` (`fx.ts:39,114-122,160-168`).
  - It inverts the quotes to USD per unit (`fx.ts:49-63`) and merges them over the fallbacks (`fx.ts:70-83`).
  - The only validation is finite and > 0 (`fx.ts:57,77`). There is no band, no move limit and no second-source check.
- **Cron route:** `apps/web/app/api/cron/update-exchange-rates/route.ts`.
  - It calls `fetchUsdRates()` (`:34`), then `fetchUsdKesReference()` (`:39`). The second call is a **second request to open.er-api.com** in the same run, which doubles the call rate against a service that asks for about one call per 24 h.
  - It writes `platform_settings.fx.usd_kes_reference` without checking for errors (`:41-50`).
  - It skips the upsert if nothing is live (`:54-59`), then calls the RPC (`:62-66`).
- **SQL:** `upsert_exchange_rates(p_rates jsonb, p_source text)`.
  - Defined in `016_background_jobs.sql:306-356`, redefined with a JWT guard in `052_definer_function_internal_guards.sql:1156-1210`.
  - It checks the enum and `rate > 0`, then runs `INSERT … ON CONFLICT DO UPDATE` with `fetched_at = NOW()`. There is no change bound and no value date.
  - Grants: service_role only (`051:60-61`). `068:16-17` revokes client writes on the table.
- **Table:** `exchange_rates(from_currency, to_currency, rate DECIMAL(20,8), source, fetched_at)` at `001_initial_schema.sql:473-482`. There is no `rate_date`. It is anon-readable (`001:1331`).
- **Read path:** `lib/currency.ts` `getUsdRate` uses the live row, then `FALLBACK_USD_RATES` from `fx-fallback.json` (`currency.ts:69-80,94-101`). Nothing reads `fetched_at` except the admin display (`components/admin/settings/CurrencyManager.tsx:115`), so **staleness is invisible at runtime**.

### 7.2 Where FX drives money

- `clob_place_order` reads the taker rate at `071_clob_index_ordered_ladder.sql:199-200` (and earlier at `046:135`).
- Settlement:
  - `069_clob_settlement_correctness.sql:275-280` divides the payout by the **current** rate.
  - `052:444-447` also reads the rate, with no FOUND check.
- Deposit: `api/payments/deposit/route.ts:106-120`.
- Credit: `lib/payments/credit.ts:58-74`.
- Withdrawal: `lib/payments/withdraw.ts:103-119`.
- Order sizing: `api/orders/route.ts:115-123`.

### 7.3 Why the cron is (almost certainly) not running

1. `vercel.json` has no `crons` key, only the build config. The app is deployed to Fly in any case.
2. `fly.toml` has one `app` process with no scheduled machines or cron process.
3. `.github/workflows/*`: the only schedules are `load-test.yml:15`, `realtime-e2e.yml:13`, `security-audit.yml:12` and `terraform.yml:14`. **None calls `/api/cron/*`.**
4. pg_cron: no migration registers the HTTP jobs.
   - Migrations 016:386-437 and 055:25-81 only **define** `schedule_kichiko_jobs(p_base_url, p_cron_secret)`.
   - An operator must run it by hand (`supabase/config.toml:147`, `docs/12-BACKGROUND-JOBS.md:65`, which says `https://app.kichiko.co.ke`).
   - The earlier 016 comment points at `https://app.marketpips.co.ke`. If it was run before the rename, the jobs target the old domain until someone re-runs the 055 helper.
   - The CRON_SECRET is **baked into the cron command text** (`055:48-49`). Rotating the Fly secret silently turns every call into 401.
   - pg_net is fire-and-forget: failures only appear in `net._http_response` and `cron.job_run_details`, which nobody watches.
5. **Timestamp evidence (INFERENCE):**
   - HANDOFF.md:159 says "the KES rate was last fetched 2026-07-28".
   - Migration 067 (commit `3476616`, 2026-07-28 14:20 UTC) sets `fetched_at = now()` for KES (`067:20-31`).
   - `fx-fallback.json` was generated 2026-07-28T14:08Z.
   - So the last write matches the migration apply, not a cron run.
6. **Diagnostics to run in prod (read-only):**
   - `select jobname, schedule, active, command from cron.job where jobname like '%exchange%';`
   - `select * from cron.job_run_details order by start_time desc limit 20;`
   - `select id, status_code, left(content,200), created from net._http_response order by created desc limit 20;`
   - `select * from job_runs where job_name='update-exchange-rates' order by started_at desc limit 10;`
   - `select from_currency, rate, source, fetched_at from exchange_rates;`

### 7.4 Manual, hardcoded or fallback-only conversions (file:line)

**Bugs: the wrong quantity is converted**

- **H1:** `apps/web/app/admin/finance/deposits/page.tsx:26-28,91`. A local `kes = n => 'KSh ' + round(n)` renders `d.amount` with the label **KSh whatever the row's `currency`** (the comment "stored natively in KES" is wrong: `deposits.currency` exists, `001:400-401`). A UGX, TZS or other non-KES row is mislabelled as shillings of Kenya. There is no numeric conversion, so the magnitude is right but the unit is wrong.
- **H2:** `apps/web/app/admin/finance/withdrawals/page.tsx:26-28,95,97`. The same local helper is applied to `w.amount` and `w.net_amount`.

**Inline rate math that bypasses `getUsdRate`**

- `apps/web/app/page.tsx:72-78`: `kesPerUsd = 1/kesRate`, with a fallback to `1/FALLBACK_USD_RATES.KES`. Used at `:237,241,242`. It uses float math and ignores staleness.
- `apps/web/app/api/orders/route.ts:115-123`: `amountUsd = o.amount_local * rate`. This is raw float math and does not go through `localToUsd` or Big.js.
- `apps/web/app/page.tsx:81`: fee fallback `?? 0.02`. This is not FX, but it is a hardcoded money constant.

**USD→KES display that always uses the bundled fallback (no `rates` argument, so it never sees the DB rate)**

- Helpers:
  - `lib/utils.ts:30` (`formatUSD`)
  - `lib/utils.ts:37` (`formatVolume`)
  - `lib/utils.ts:50` (`formatMoneyCompact`)
  - `lib/leaderboard.ts:128` (`formatUsd`) and `:132+` (`formatSignedUsd`)
  - `components/markets/market-card.tsx:86` (`volShort`)
  - `app/portfolio/page.tsx:248`
- Call sites of those helpers (46):
  - `components/profile/trader-portfolio.tsx:113,153,210,411,429,431`
  - `components/profile/profile-view.tsx:42`
  - `components/profile/trader-pnl-card.tsx:141,198`
  - `components/profile/share-chart-modal.tsx:82`
  - `components/markets/market-card.tsx:332`
  - `components/markets/contract-specs.tsx:63`
  - `components/markets/top-holders.tsx:87,98,105`
  - `components/markets/price-chart.tsx:279`
  - `components/markets/movers-rail.tsx:46`
  - `components/markets/outcomes-chart.tsx:320`
  - `components/markets/market-positions.tsx:79,82`
  - `components/trading/position-summary.tsx:116,138,143`
  - `components/trading/candidate-list.tsx:337`
  - `components/trading/order-book-table.tsx:213`
  - `components/layout/hero-section.tsx:62`
  - `components/portfolio/allocation-donut.tsx:56,111,141`
  - `components/portfolio/holdings-table.tsx:40,129,154`
  - `components/portfolio/summary-cards.tsx:25,42,52,67,76`
  - `components/leaderboard/leaderboard-view.tsx:75,76,294,298,626,635`
  - `app/traders/[id]/page.tsx:127,129`
  - `lib/utils.ts:48`

  Today these show UGX-style drift of up to 5.9% for non-KES users. KES is only off by 0.07% because it was stable.
- Admin `kes()`/`kes2()` from `lib/admin/money.ts` called without `rates` (these use the fallback too):
  - `app/admin/users/[id]/page.tsx:103,104`
  - `app/admin/users/page.tsx:119`
  - `app/admin/marketers/[id]/page.tsx:73,80,81`
  - `app/admin/marketers/payouts/[id]/page.tsx:42`
  - `app/admin/marketers/payouts/page.tsx:52`
  - `app/admin/marketers/campaigns/page.tsx:51,52`
  - `app/admin/creators/[id]/page.tsx:70`

**Hardcoded "KES is the display currency", whatever the user's currency**

- All of the helpers above hardcode `'KES'`.
- `components/admin/growth/MarketerActions.tsx:109,144` and `components/admin/growth/CampaignForm.tsx:35,36` convert admin input as KES. These are acceptable only if admin input is defined as KES.

**Hardcoded rate literals**

- `apps/web/lib/generated/fx-fallback.json:6-12`: generated 2026-07-28. It is the runtime fallback for **every** read path.
- `supabase/migrations/001_initial_schema.sql:485-493`: seed rates.
- `supabase/migrations/038_kes_peg_ksh100.sql:14-21`: peg 0.01. It is reversed by 067, but still replays on fresh databases before 067.
- `supabase/migrations/067_kes_realtime_fx.sql:20-31`: KES 0.00775 bootstrap.
- **`supabase/seed/seed.sql:15-25` still seeds KES = 0.01 `'pilot-peg-ksh100'`.** Local and dev databases are therefore re-pegged, which contradicts 067 and the current code comments.
- `scripts/sim/rebase_to_kes_peg.py`: a peg-era simulation script, listed for completeness.

**SQL arithmetic at the current rate** (see audit findings 2 and 7; this report does not re-analyse them)

- `052:444-447`
- `069:275-280`
- `046:135-136,271,329`

---

## 8. Parsing rules (normalise everything to `units_per_usd`)

| Source | Request | Pick | Transform | Value date |
|---|---|---|---|---|
| CBK | POST form `draw=1&start=0&length=-1` (or filtered, UNVERIFIED) | rows where `row[1]=='US DOLLAR'` → KES; `'KES / USHS'` etc. → cross | KES = `mean`; X = `USD_mean × cross` | `row[0]` `%d/%m/%Y` |
| BNR | GET `?currency_name=USD&start_date=D-7&end_date=D` (+ UGX/TZS/BIF/KES) | max `post_date` | RWF = `average_rate` (strip `,`); X = `USD_avg / X_avg` | `post_date` `%d-%b-%y` |
| BoZ | GET JSON:API → follow `included[].attributes.uri.url` → XLSX | last visible data row | ZMW = (Buy + Sale)/2 for the `DOLLAR` column | Excel serial + 1899-12-30 |
| NBE | GET `?date=D` (walk back up to 7 days on empty) | `currency.code=='USD'` | ETB = `weighted_average` | `date` (= previous-day transactions) |
| BoT | GET token + cookie → POST `dateFrom/dateTo` | `tbody tr` where Currency `USD` | TZS = Mean (strip `,`) | `Date` `%d-%b-%y` |
| BRB | GET index → newest PDF → text | line `1 Dollar USA …` | BIF = third number (Cours moyen), `,` → `.` | from the filename `DD-MM-YYYY` |
| Frankfurter v2 | GET `/v2/rates?base=USD&quotes=…&expand=providers` | each record | `rate` = units per USD; audit `providers[]` | `date` |
| fawazahmed0 | GET jsDelivr → pages.dev → npm tgz | `usd.<ccy>` | as is | top-level `date` |

---

## 9. Integration plan for the repo

**Step 0: verify from a network that can reach the hosts (15 min).** From a Fly machine or a laptop, run one `curl` per endpoint in §8. Save the responses as fixtures under `apps/web/lib/integrations/__fixtures__/fx/`. This closes every BLOCKED-BY-SANDBOX item.

**Step 1: get the cron running today (no code change).**

- Run the read-only diagnostics in §7.3.6.
- Then run `select public.schedule_kichiko_jobs('https://<current prod domain>', '<current CRON_SECRET>');`.
- Add `.github/workflows/fx-refresh.yml` as a **second, observable** trigger:
  ```yaml
  on:
    schedule: [{cron: '23 5,11,17,23 * * *'}]
  ```
  Its job runs `curl -fsS -X POST $APP_URL/api/cron/update-exchange-rates -H "x-cron-secret: $CRON_SECRET"`, so the workflow goes red on non-2xx.
- Caveat: GitHub cron schedules are best-effort and can be delayed (UNVERIFIED; docs host not reachable here).

**Step 2: schema (migration 073).**

```sql
create table public.fx_observations (
  id bigserial primary key,
  currency currency_code not null,
  source text not null,              -- 'CBK','BNRRW','BOZ','NBE','BOTA','BRB','CBK-cross','BNRRW-cross','fawaz','erapi','frankfurter'
  rate_date date not null,           -- publisher's value date
  units_per_usd numeric(20,8) not null check (units_per_usd > 0),
  fetched_at timestamptz not null default now(),
  raw jsonb,
  unique (currency, source, rate_date)
);
alter table public.exchange_rates
  add column units_per_usd numeric(20,8),
  add column rate_date date,
  add column sources jsonb,          -- [{source, units_per_usd, rate_date}]
  add column status text not null default 'ok' check (status in ('ok','degraded','stale','quarantined'));
```

- Add `upsert_exchange_rates_v2`, which applies the §6 gates, writes `rate = 1/units_per_usd` at higher precision, and keeps the service_role-only grants.
- Add `fx_is_fresh(p_currency)`, called by `clob_place_order`, `request_withdrawal` and `credit_deposit` for the §6.5 hard block.
- Fix `supabase/seed/seed.sql:15-25`, which still re-pegs KES.

**Step 3: fetcher (`lib/integrations/fx.ts`).**

- Replace the single-provider logic with `fetchAllSources(): Observation[]`. It runs Frankfurter v2 (`expand=providers`), fawazahmed0 (three mirrors) and, optionally, ExchangeRate-API **once**.
- Keep the pure functions testable, and add `normalize()`, `crossDerive()` and `choose()` (median of the sources that agree).
- Remove the second `fetchUsdKesReference` call. Derive the platform setting from the chosen KES value instead.
- If Frankfurter's public host proves unreliable, deploy `lineofflight/frankfurter` as a Fly app (`kichiko-fx`, SQLite volume) and point `FX_FRANKFURTER_URL` at it.

**Step 4: read path.**

- Make `fetchRatesMap` / `useRates` also return `rate_date` and `status`.
- Show a "rates as of …" line plus the attribution line, which ExchangeRate-API requires if it stays in use.
- Thread `rates` into `formatUSD`, `formatVolume`, `formatMoneyCompact`, leaderboard `formatUsd` / `formatSignedUsd`, `volShort` and the admin `kes`/`kes2` helpers. Alternatively, make those helpers read a server-provided rates context. Then the fallback JSON is used only when the DB is unreachable.
- Fix H1 and H2 by formatting in the row's own currency: `formatCurrency(d.amount, d.currency)`, with an optional USD column from `exchange_rate_to_usd`.
- Replace the inline math at `page.tsx:72-78` and `orders/route.ts:115-123` with `getUsdRate` / `localToUsd`.

**Step 5: health and alerts.**

- `/api/health` reports `fx: {max_age_h, stale: [...], quarantined: [...]}` and a degraded status when `max_age_h > 72`.
- `job_runs` should record per-source success, so a dead source shows up before the fallback chain runs out.
- `scripts/ops/refresh_fx_fallback.py` should read from the same multi-source fetcher. Run it weekly in CI, as a PR bot, so the bundled fallback never drifts by 6% again.

**Step 6: tests.** Add unit tests with the recorded fixtures: CBK cross inversion, BNR comma values and unordered dates, BoZ serial dates, NBE's previous-day date, and the gate thresholds. Include a replay of 2024-02-16 KES −4.9%: with two agreeing sources it must pass, with one source it must quarantine.

---

## 10. Sources

**Code and data actually fetched**

- fawazahmed0/exchange-api (README, `currscript.js`, `.github/workflows/run.yml`, `LICENSE` = CC0):
  - https://raw.githubusercontent.com/fawazahmed0/exchange-api/main/README.md
  - …/currscript.js
  - …/.github/workflows/run.yml
  - …/LICENSE
- npm dataset: https://registry.npmjs.org/@fawazahmed0/currency-api and `…/-/currency-api-2026.9.26.tgz`, plus 208 earlier daily tarballs.
- Frankfurter (MIT), path prefix https://raw.githubusercontent.com/lineofflight/frankfurter/main/:
  - `README.md`, `AGENTS.md`, `bin/schedule`, `lib/public/v2/openapi.json`
  - `lib/provider/adapters/{cbk,bnrrw,bota,boz,nbe,brb,imf}.rb`
  - `db/seeds/providers/{cbk,bota,bnrrw,boz,nbe,brb,imf,ecb}.json`
  - `spec/vcr_cassettes/{cbk,bnrrw,nbe,bota,boz,brb,imf}.yml`, which hold the recorded responses with the recording dates given in §2.
- Other GitHub code (search results):
  - `williamluke4/erpnext_cbk_exchange_rate/cbk_exchange_rate/cbk_exchange_rate/fetch.py`
  - `peregin/exchange-rate-service/README.md`
  - `plugintheworld/historic_bank_rates/lib/historic_bank_rates/bank_scrapers/central_bank_of_kenya.rb`
  - `SebKrantz/shiny-data-portal/get_data.R`
  - `projet224solutions-afk/vista-flows/backend/src/services/fxRates.service.ts`

**WebSearch snippets** (pages themselves BLOCKED; cited as snippets only)

- https://www.centralbank.go.ke/rates/forex-exchange-rates/
- https://www.bou.or.ug/interest_rates_exchange_rates
- https://www.bot.go.tz/exchangerate/excrates
- https://fxrates.bnr.rw/
- https://nbe.gov.et/exchange/indicatives-rates/
- https://www.exchangerate-api.com/docs/free
- https://www.exchangerate-api.com/product/our-exchange-rate-data
- https://support.openexchangerates.org/article/69-plans-pricing-guide
- https://exchangerate.host/documentation
- https://frankfurter.dev/
- https://en.wikipedia.org/wiki/2024_Ethiopian_foreign_exchange_rate_policy

**Repo files** (read-only; commit `9000255e`):

- `apps/web/lib/integrations/fx.ts`
- `apps/web/app/api/cron/update-exchange-rates/route.ts`
- `apps/web/lib/currency.ts`
- `apps/web/lib/generated/fx-fallback.json`
- `supabase/migrations/{001,016,038,051,052,055,057,067,068,069,071}_*.sql`
- `supabase/seed/seed.sql`
- `supabase/config.toml`
- `vercel.json`, `fly.toml`, `.github/workflows/*`
- `docs/12-BACKGROUND-JOBS.md`
- `scripts/ops/refresh_fx_fallback.py`
- the call sites listed in §7.4

Scratch artifacts from this analysis are in `/tmp/claude-0/-home-user-kichiko/385cc00d-340c-5f67-955a-0a985fc3ce7d/scratchpad/fx/`: `hist/*.json` (209 daily snapshots), `ff/` (Frankfurter adapters and cassettes), and `package/v1/currencies/usd.json`.
