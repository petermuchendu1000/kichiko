# Kichiko — Kenya 2026 seed pipeline

Rigorous, reproducible seed data for a realistic East-Africa prediction market.
All content is grounded in live **July-2026** reporting and every market cover and
multi-outcome option carries a **real image** (no placeholders).

## Layout
- `catalog.py` — single source of truth for markets & options (researched, dated,
  with `(entity_kind, entity_ref)` image refs and initial "house" probabilities).
- `seed_markets.py` — idempotent upsert of markets + options with coherent prices.
- `backfill_images.py` — resolves real imagery per entity (person→Wikipedia,
  company→favicon/Wikipedia, crypto→CoinCap, place→flag CDN), normalises to a
  256px WebP, uploads to the public `entity-media` bucket, persists the URLs.

## Run order
```bash
export SUPABASE_DB_URL="postgresql://…:5432/postgres"
export SUPABASE_URL="https://<ref>.supabase.co"
export SUPABASE_SECRET="<service/secret key>"     # storage write

python3 supabase/seed/kenya2026/seed_markets.py     # markets + options
python3 supabase/seed/kenya2026/backfill_images.py  # real imagery
# then the crowd/dynamics scripts (see repo scripts/): demo traders,
# price history, activity, and Sheng comments.
```

No secrets are committed — everything is read from the environment.

## Coverage (this snapshot)
40 catalog markets (33 binary + 7 multi-outcome, 33 options) across 12 categories,
plus the engine-generated BTC "Up or Down?" recurring markets. 100% image coverage.
