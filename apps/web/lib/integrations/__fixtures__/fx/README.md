# Recorded FX provider responses (test fixtures)

Real responses, trimmed only where noted, used to test the parsers in `lib/integrations/fx-sources.ts`. Nothing here is synthetic.

| File | Source | Recorded | Trimmed |
|---|---|---|---|
| `cbk-table193-2026-03-19.json` | Central Bank of Kenya, `POST https://www.centralbank.go.ke/wp-admin/admin-ajax.php?action=get_wdtable&table_id=193` (`draw=1&start=0&length=-1`) | 2026-03-23 00:06 GMT | Kept the 3 most recent value dates of 11,550 rows (`recordsTotal` adjusted) |
| `bnr-rw-usd-2026-05-19_22.json` | National Bank of Rwanda, `GET https://fxrates.bnr.rw/currency_history/?currency_name=USD&start_date=2026-05-19&end_date=2026-05-22` | 2026-05-24 06:42 GMT | No |
| `nbe-2026-05-18.json` | National Bank of Ethiopia, `GET https://api.nbe.gov.et/api/filter-exchange-rates?date=2026-05-18` | 2026-05-22 12:50 GMT | No |
| `fawazahmed0-usd-2026-09-26.json` | npm `@fawazahmed0/currency-api@2026.9.26`, `v1/currencies/usd.json` (same file served by jsDelivr / `currency-api.pages.dev`) | published 2026-09-26 04:30 UTC | No |

The first three were recorded by the Frankfurter project (`spec/vcr_cassettes/{cbk,bnrrw,nbe}.yml` in https://github.com/lineofflight/frankfurter, MIT licence, Copyright (c) Hakan Ensari) and extracted from those cassettes on 2026-09-26. The sandbox that wrote this code could not reach the central banks directly, so each live endpoint still needs one check from production (see `docs/research/engine-2026-09/14-FX-SOURCES.md` §1).
