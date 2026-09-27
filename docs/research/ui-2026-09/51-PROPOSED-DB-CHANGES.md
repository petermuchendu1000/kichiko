# 51 — Database changes

> **Update 2026-09-27:** on the owner's instruction ("push changes even to the database"),
> D1–D3 became migration `105_order_guards_and_leaderboard_grant.sql`, with harness cases O10–O12
> in `scripts/ops/clob/test_place_order_for.py`. D1 refuses **buys** on hidden markets (P0186) and
> keeps sells open so holders can exit; D2 raises P0185; D3 also revokes from PUBLIC (production's
> ACL showed `=X/postgres`, i.e. PUBLIC could execute). **Applied to production 2026-09-27 11:10
> UTC** by the Deploy Staging workflow on the merge to `main`; verification in
> [50](50-EXECUTION-LOG.md). The "not applied" notes below describe the state before that.
> D4 still needs the owner's decisions.

Written 2026-09-27 while executing work plan v2. Each item closes a gap that app code cannot
close, because the database is the only layer every client goes through. **None is applied to
production.** Each changes trading or KYC behaviour, so each needs the owner's approval, and the
SQL must be run in the repo's ephemeral-Postgres harness (`scripts/ops/clob/test_place_order_for.py`,
CI job "CLOB invariants") before any production apply. This sandbox has no Docker, so none of the
SQL below has been executed.

## D1 — Refuse orders on hidden markets

**Gap (verified in code):** `place_order_for` (migration 104) checks the account, the option's
`is_active` and the wallet's `is_active`, but not `markets.is_hidden`. The two markets hidden on
2026-09-27 (L.1) can still take orders from any client that knows their id. Migration 104's own
header records this as deferred product policy (register A-X4).

**Change:** in `place_order_for`, replace the market lookup (104, line 81) with one that also reads
`is_hidden`, and refuse when true:

```sql
SELECT pricing_engine, is_hidden INTO v_engine, v_hidden FROM public.markets WHERE id = p_market_id;
IF NOT FOUND THEN RAISE EXCEPTION 'Market not found' USING ERRCODE = 'P0001'; END IF;
IF v_hidden THEN
  RAISE EXCEPTION 'This market is not open for trading' USING ERRCODE = 'P0199';
END IF;
```
(`v_hidden boolean` added to DECLARE; reusing P0199 means the app already maps it to 409.)

**Open question for the owner:** whether *selling* existing positions on a hidden market should
remain possible (letting holders exit) while buying is refused. The snippet above refuses both.

**Test to add:** O10 — hide a market, expect P0199 on buy and on sell.

## D2 — Statutory minimum stake in every currency

**Gap:** the app now enforces KSh 20 (Gambling Control Act 2025 s.71(1)) in the ticket and, for a
KES market buy, in the API. The API only sees the client's *asserted* currency; the settlement
currency is decided inside `place_order_for`, and limit orders are size × price.

**Change:** after the settlement-currency checks (104, around line 79), compute the order's cost in
the user's settlement currency and refuse under the minimum:

```sql
-- KSh 20 minimum, expressed in the settlement currency via the same rate table used below.
v_min_local := CASE v_prof.settlement_currency WHEN 'KES' THEN 20 ELSE <policy> END;
v_cost_local := COALESCE(p_amount_local,
                         p_size * (p_price_cents / 100.0) / v_rate);  -- USD → local
IF p_action = 'buy' AND v_cost_local < v_min_local THEN
  RAISE EXCEPTION 'The minimum stake is KSh 20' USING ERRCODE = 'P0197';
END IF;
```
`<policy>` for UGX/TZS/RWF is an owner decision: Kenya's minimum is statutory; the other countries'
statutes read so far set none. The app currently uses KSh 20 converted and rounded up on a 1-2-5
ladder (`lib/stake.ts`). Map P0197 to 400 in `lib/clob.ts`.

**Test to add:** O11 — KES market buy of 19 → P0197; 20 → accepted; limit buy of 30 shares at 50¢
(≈ KSh 1,944) → accepted.

## D3 — Close the leaderboard RPC to the public

**Gap:** the profit leaderboard page and `/api/leaderboard` are paused (410), but
`get_leaderboard` is still executable by `anon` and `authenticated` directly through PostgREST
(`GRANT EXECUTE … TO anon, authenticated`, migration 007 line 352; body replaced in 092).

**Change:**
```sql
REVOKE EXECUTE ON FUNCTION public.get_leaderboard(text, text, int) FROM anon, authenticated;
```
Reversible with the original GRANT. Keep the function for the opt-in accuracy board.

## D4 — Identity, location and age before any deposit (Reg. 82)

**Gap (verified first-hand):** L.N. 112 of 2026 Reg. 82(1): "A licensee shall not allow a person to
participate in any form of online gambling without conducting mandatory identity check, location
verification, and age assurance check." Reg. 82(2): verification uses "reliable, independent and
electronically verifiable data sources prior to player account activation and receipt of any
wagering deposit." Reg. 82(3): verify the winner's identity before paying winnings.

Today KYC is deferred: deposits and trading require none; withdrawals require it only above $100
behind `flags.withdraw_kyc_gate` (`lib/payments/withdraw.ts`). KYC collects document images and a
selfie for manual review and **no date of birth** (`kyc_documents`, migration 001), so no age can be
computed. Uganda's minimum is 25 (Lotteries and Gaming Act 2016 s.1, s.57 — verified first-hand).

**What it takes (owner decisions first):**
1. An electronic identity source that meets "reliable, independent and electronically verifiable"
   — for Kenya that likely means an IPRS-backed provider. Vendor choice and cost are the owner's.
2. Store `date_of_birth` and the verification reference on the KYC record; compute eligibility
   with `lib/eligibility.ts` (KE 18, UG 25, TZ 18, RW 18; unknown country → strictest).
3. Gate deposit initiation and order placement on a verified, age-eligible, location-checked
   profile. This **blocks every current unverified user from depositing** until they verify, so it
   needs a migration plan and user communication.
4. Keep the flow order from the research ([32] rule 13): browse and preview without an account;
   verify before the first deposit.
