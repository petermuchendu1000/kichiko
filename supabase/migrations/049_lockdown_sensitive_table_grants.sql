-- 049_lockdown_sensitive_table_grants.sql
-- Defense-in-depth: remove stray client-role grants on sensitive/internal
-- tables. All four have RLS enabled with no policies (deny-all for non-owner
-- roles) and are reached ONLY through SECURITY DEFINER RPCs + the service_role
-- (verified: no direct .from()/.rpc() client access in apps/). The leftover
-- grants add needless attack surface and, worse, let a client WRITE price-feed
-- data if RLS were ever misconfigured -- a market-resolution fraud vector.
--
--   * gateway_secrets       -- payment gateway secrets; must never be client-
--                              reachable. Read path: admin_get_gateway_secret
--                              (capability-gated) + service_role.
--   * btc_price_ticks       -- BTC price feed; read via latest_btc_price() etc.,
--   * btc_series_config        written only by cron/definer functions. Clients
--   * btc_windows              must never read or write these directly.

REVOKE ALL ON public.gateway_secrets  FROM anon, authenticated;
REVOKE ALL ON public.btc_price_ticks  FROM anon, authenticated;
REVOKE ALL ON public.btc_series_config FROM anon, authenticated;
REVOKE ALL ON public.btc_windows      FROM anon, authenticated;
