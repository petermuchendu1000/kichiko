-- scripts/ci/clob_seed.sql
-- Minimal deterministic seed for the CLOB invariant harnesses: 6 users. The
-- on_auth_user_created trigger auto-creates each profile + default-currency
-- wallets; the harnesses add USD wallets and throwaway markets, then ROLL BACK
-- (nothing persists). fuzz_invariants needs >=6 profiles, test_two_sided >=4,
-- test_046 >=1.
INSERT INTO auth.users(id, email, raw_user_meta_data)
SELECT gen_random_uuid(), 'clobci'||g||'@example.com',
       jsonb_build_object('display_name','CLOB CI '||g,'country_code','KE')
FROM generate_series(1,6) g;
