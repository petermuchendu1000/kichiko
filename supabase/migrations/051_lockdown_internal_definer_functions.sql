-- 051_lockdown_internal_definer_functions.sql
-- CRITICAL authorization hardening. A whole family of SECURITY DEFINER functions
-- that are internal service-role/cron/admin-wrapper primitives had EXECUTE
-- granted to anon + authenticated (PostgREST RPC). They run as `postgres`
-- (BYPASSRLS, table owner) and have NO internal authorization guard, so any
-- unauthenticated or logged-in caller could invoke them via
-- POST /rest/v1/rpc/<fn> and:
--   * credit_deposit           -> mint balance into a wallet
--   * complete/request/fail_withdrawal -> forge/settle withdrawals (request_withdrawal
--                                 even takes p_user_id, so on behalf of anyone)
--   * resolve_market*/cancel_market -> resolve any market to a chosen outcome (payout)
--   * upsert_exchange_rates    -> mis-price all FX conversions
--   * admin_review_kyc         -> self-approve KYC (AML bypass)
--   * record_btc_tick/resolve_btc_windows/open_btc_windows/btc_tick_cron -> BTC
--                                 oracle manipulation and forced settlement
--   * record_job_*, *_notification_deliveries, refresh_* -> spoof job/observability
--                                 records, spam notifications, or DoS via matview refresh
--   * schedule_marketpips_*    -> schedule cron to an attacker URL (SSRF / abuse)
--
-- Confirmed live (rolled back): a plain `authenticated` user reached the business
-- logic of credit_deposit / resolve_market / upsert_exchange_rates /
-- request_withdrawal (P00xx errors, NOT 42501). Migration 049 only revoked TABLE
-- grants; these definer functions bypass table grants, so the RPC path stayed open.
--
-- Fix (mirrors the CLOB 042 lockdown): revoke EXECUTE from anon/authenticated/
-- PUBLIC and keep it to service_role (the app's admin client) + postgres (owner;
-- pg_cron). Verified: every one of these is only ever invoked in-app via the
-- service-role admin client (payments/*, markets resolve/status, api/cron/*) or
-- pg_cron -- no client path exists, so there is no functional regression.

-- Payments / deposits / withdrawals (mint money, forge/settle withdrawals)
REVOKE EXECUTE ON FUNCTION public.credit_deposit(p_deposit_id uuid, p_amount_usd numeric, p_exchange_rate numeric, p_provider_receipt text, p_raw_callback jsonb, p_idempotency_key text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.credit_deposit(p_deposit_id uuid, p_amount_usd numeric, p_exchange_rate numeric, p_provider_receipt text, p_raw_callback jsonb, p_idempotency_key text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fail_deposit(p_deposit_id uuid, p_reason text, p_raw_callback jsonb) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fail_deposit(p_deposit_id uuid, p_reason text, p_raw_callback jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.complete_withdrawal(p_withdrawal_id uuid, p_provider_reference text, p_provider_receipt text, p_raw_response jsonb) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.complete_withdrawal(p_withdrawal_id uuid, p_provider_reference text, p_provider_receipt text, p_raw_response jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fail_withdrawal(p_withdrawal_id uuid, p_reason text, p_raw_response jsonb) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fail_withdrawal(p_withdrawal_id uuid, p_reason text, p_raw_response jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.request_withdrawal(p_user_id uuid, p_wallet_id uuid, p_amount numeric, p_amount_usd numeric, p_exchange_rate numeric, p_fee_amount numeric, p_provider payment_provider, p_phone text, p_requires_review boolean) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.request_withdrawal(p_user_id uuid, p_wallet_id uuid, p_amount numeric, p_amount_usd numeric, p_exchange_rate numeric, p_fee_amount numeric, p_provider payment_provider, p_phone text, p_requires_review boolean) TO service_role;

-- Market settlement / lifecycle (rig outcomes -> payouts)
REVOKE EXECUTE ON FUNCTION public.resolve_market(p_market_id uuid, p_outcome order_side, p_resolver_id uuid, p_resolution_notes text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.resolve_market(p_market_id uuid, p_outcome order_side, p_resolver_id uuid, p_resolution_notes text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.resolve_market_options(p_market_id uuid, p_winning_option_id uuid, p_resolver_id uuid, p_resolution_notes text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.resolve_market_options(p_market_id uuid, p_winning_option_id uuid, p_resolver_id uuid, p_resolution_notes text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.resolve_market_options_binary(p_market_id uuid, p_winning_option_id uuid, p_resolver_id uuid, p_resolution_notes text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.resolve_market_options_binary(p_market_id uuid, p_winning_option_id uuid, p_resolver_id uuid, p_resolution_notes text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cancel_market(p_market_id uuid, p_reason text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cancel_market(p_market_id uuid, p_reason text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.close_due_markets(p_limit integer) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.close_due_markets(p_limit integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.flag_markets_due_for_resolution(p_limit integer) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.flag_markets_due_for_resolution(p_limit integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.set_market_pricing_independent(p_market_id uuid) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.set_market_pricing_independent(p_market_id uuid) TO service_role;

-- FX + KYC (mis-price conversions / self-approve KYC)
REVOKE EXECUTE ON FUNCTION public.upsert_exchange_rates(p_rates jsonb, p_source text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.upsert_exchange_rates(p_rates jsonb, p_source text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.admin_review_kyc(p_doc_id uuid, p_status kyc_status, p_reviewer_id uuid, p_rejection_reason text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.admin_review_kyc(p_doc_id uuid, p_status kyc_status, p_reviewer_id uuid, p_rejection_reason text) TO service_role;

-- BTC oracle engine (poison feed / force settlement)
REVOKE EXECUTE ON FUNCTION public.record_btc_tick(p_price numeric, p_source text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.record_btc_tick(p_price numeric, p_source text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.resolve_btc_windows(p_resolver uuid) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.resolve_btc_windows(p_resolver uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.open_btc_windows(p_creator uuid, p_resolution_source text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.open_btc_windows(p_creator uuid, p_resolution_source text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.btc_tick_cron() FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.btc_tick_cron() TO service_role;

-- Workers / observability / notifications / stats (spoof jobs, spam, DoS refresh)
REVOKE EXECUTE ON FUNCTION public.record_job_start(p_job_name text, p_request_id text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.record_job_start(p_job_name text, p_request_id text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.record_job_finish(p_id uuid, p_status text, p_result jsonb, p_error text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.record_job_finish(p_id uuid, p_status text, p_result jsonb, p_error text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.enqueue_notification_deliveries() FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.enqueue_notification_deliveries() TO service_role;
REVOKE EXECUTE ON FUNCTION public.claim_notification_deliveries(p_limit integer) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.claim_notification_deliveries(p_limit integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.complete_notification_delivery(p_id uuid, p_success boolean, p_provider_message_id text, p_error text, p_backoff_seconds integer) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.complete_notification_delivery(p_id uuid, p_success boolean, p_provider_message_id text, p_error text, p_backoff_seconds integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.refresh_market_stats() FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.refresh_market_stats() TO service_role;
REVOKE EXECUTE ON FUNCTION public.refresh_leaderboard() FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.refresh_leaderboard() TO service_role;

-- Cron schedulers (arbitrary URL + secret -> SSRF / cron abuse)
REVOKE EXECUTE ON FUNCTION public.schedule_marketpips_jobs(p_base_url text, p_cron_secret text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.schedule_marketpips_jobs(p_base_url text, p_cron_secret text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.schedule_marketpips_btc_jobs(p_base_url text, p_cron_secret text) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.schedule_marketpips_btc_jobs(p_base_url text, p_cron_secret text) TO service_role;
