-- ============================================================
-- Kichiko - Seed Data
-- East Africa-focused prediction markets
-- ============================================================

-- Create a demo admin user (update ID after creating via auth)
-- Run this AFTER creating your first user via auth:
--
-- UPDATE public.profiles SET role = 'admin'
-- WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@kichiko.co.ke');

-- ============================================================
-- INITIAL EXCHANGE RATES (approximate)
-- ============================================================
INSERT INTO public.exchange_rates (from_currency, to_currency, rate, source) VALUES
  ('KES', 'USD', 0.01,  'pilot-peg-ksh100'),
  ('UGX', 'USD', 0.000267, 'seed'),
  ('TZS', 'USD', 0.000385, 'seed'),
  ('RWF', 'USD', 0.000714, 'seed'),
  ('ZMW', 'USD', 0.0385,   'seed'),
  ('ETB', 'USD', 0.00714,  'seed'),
  ('BIF', 'USD', 0.000333, 'seed'),
  ('USD', 'USD', 1.0,      'seed')
ON CONFLICT (from_currency, to_currency) DO UPDATE
  SET rate = EXCLUDED.rate;

-- ============================================================
-- SAMPLE MARKETS (will need a valid creator_id — update below)
-- ============================================================

-- NOTE: Replace 'YOUR-ADMIN-UUID' with your actual admin user UUID
-- You can get it from: SELECT id FROM auth.users LIMIT 1;

DO $$
DECLARE
  admin_id UUID;
BEGIN
  -- Try to find the first admin user
  SELECT id INTO admin_id FROM public.profiles WHERE role = 'admin' LIMIT 1;

  -- If no admin, skip market seeding
  IF admin_id IS NULL THEN
    RAISE NOTICE 'No admin user found. Skipping market seed. Create an admin user first.';
    RETURN;
  END IF;

  -- ========================
  -- POLITICS & ELECTIONS
  -- ========================
  INSERT INTO public.markets (
    slug, title, description, category, resolution_criteria,
    creator_id, status, opens_at, closes_at, resolves_at,
    yes_price, no_price, liquidity_pool_usd, initial_liquidity_usd,
    is_featured, featured_order, tags, allowed_countries
  ) VALUES
  (
    'kenya-nairobi-governor-2027',
    'Will the current Nairobi Governor win re-election in 2027?',
    'Kenya''s 2027 gubernatorial elections are scheduled for August 2027. This market resolves YES if the incumbent Nairobi County Governor wins re-election.',
    'elections',
    'Resolves YES if the incumbent Nairobi Governor is declared winner by IEBC in the 2027 general elections.',
    admin_id, 'active', NOW(), '2027-08-05', '2027-08-20',
    0.62, 0.38, 500, 500,
    TRUE, 1, ARRAY['kenya', 'nairobi', 'elections', '2027'],
    ARRAY['KE', 'TZ', 'UG', 'RW', 'ZM', 'ET', 'BI']
  ),
  (
    'tanzania-ccm-2025-election',
    'Will CCM win Tanzania''s 2025 general election?',
    'Tanzania holds general elections in October 2025. CCM (Chama Cha Mapinduzi) has ruled Tanzania since independence.',
    'elections',
    'Resolves YES if CCM candidate is declared the winner of the 2025 Tanzanian presidential election.',
    admin_id, 'active', NOW(), '2025-10-25', '2025-11-10',
    0.78, 0.22, 300, 300,
    TRUE, 2, ARRAY['tanzania', 'ccm', 'elections', '2025'],
    ARRAY['KE', 'TZ', 'UG', 'RW', 'ZM', 'ET', 'BI']
  ),

  -- ========================
  -- ECONOMICS
  -- ========================
  (
    'kenya-inflation-below-5-dec-2025',
    'Will Kenya''s inflation rate be below 5% in December 2025?',
    'Kenya''s Central Bank targets 5% inflation (±2.5%). This market tracks whether CPI y/y will be under 5% as of December 2025 KNBS data.',
    'economics',
    'Resolves YES if KNBS official December 2025 CPI year-on-year inflation rate is below 5.0%.',
    admin_id, 'active', NOW(), '2025-12-20', '2026-01-15',
    0.55, 0.45, 200, 200,
    FALSE, NULL, ARRAY['kenya', 'inflation', 'economics', 'CBK'],
    ARRAY['KE', 'TZ', 'UG', 'RW', 'ZM', 'ET', 'BI']
  ),
  (
    'ugandan-shilling-4000-usd-2025',
    'Will USD/UGX exceed 4,000 shillings by end of 2025?',
    'Uganda''s shilling has been under pressure. This market asks if the exchange rate will reach 4,000 UGX per USD by December 31, 2025.',
    'economics',
    'Resolves YES if the Bank of Uganda official mid-rate for USD/UGX is 4,000 or above on any day in December 2025.',
    admin_id, 'active', NOW(), '2025-12-31', '2026-01-05',
    0.42, 0.58, 150, 150,
    FALSE, NULL, ARRAY['uganda', 'currency', 'forex', 'shilling'],
    ARRAY['KE', 'TZ', 'UG', 'RW', 'ZM', 'ET', 'BI']
  ),

  -- ========================
  -- SPORTS
  -- ========================
  (
    'afcon-2025-winner-kenya',
    'Will Kenya qualify for AFCON 2025?',
    'Kenya''s Harambee Stars is competing in the 2025 AFCON qualifiers. Will they make it to the tournament?',
    'sports',
    'Resolves YES if Kenya Football Federation officially qualifies Harambee Stars for the 2025 Africa Cup of Nations.',
    admin_id, 'active', NOW(), '2025-11-01', '2025-11-15',
    0.35, 0.65, 400, 400,
    TRUE, 3, ARRAY['kenya', 'football', 'AFCON', 'harambee-stars'],
    ARRAY['KE', 'TZ', 'UG', 'RW', 'ZM', 'ET', 'BI']
  ),
  (
    'marathon-kenyan-wins-berlin-2025',
    'Will a Kenyan athlete win the 2025 Berlin Marathon?',
    'Kenya has dominated marathon running for decades. Will a Kenyan take the top spot at Berlin 2025?',
    'sports',
    'Resolves YES if an athlete holding a Kenyan passport wins the men''s or women''s elite race at the 2025 Berlin Marathon.',
    admin_id, 'active', NOW(), '2025-09-28', '2025-09-30',
    0.72, 0.28, 250, 250,
    FALSE, NULL, ARRAY['kenya', 'marathon', 'athletics', 'berlin'],
    ARRAY['KE', 'TZ', 'UG', 'RW', 'ZM', 'ET', 'BI']
  ),

  -- ========================
  -- CRYPTO
  -- ========================
  (
    'btc-100k-dec-2025',
    'Will Bitcoin reach $100,000 by December 31, 2025?',
    'Bitcoin has seen significant growth. This market asks if BTC/USD will reach $100,000 at any point before December 31, 2025.',
    'crypto',
    'Resolves YES if the BTC/USD price on Binance spot market reaches or exceeds $100,000 at any point on or before Dec 31 2025 23:59 UTC.',
    admin_id, 'active', NOW(), '2025-12-31', '2026-01-02',
    0.68, 0.32, 1000, 1000,
    TRUE, 4, ARRAY['bitcoin', 'BTC', 'crypto', '100k'],
    ARRAY['KE', 'TZ', 'UG', 'RW', 'ZM', 'ET', 'BI']
  ),
  (
    'eth-price-above-4000-sept-2025',
    'Will Ethereum be above $4,000 on September 30, 2025?',
    'Ethereum''s price depends on network upgrades, DeFi activity, and broader market conditions.',
    'crypto',
    'Resolves YES if ETH/USD price on Binance spot market is above $4,000 at 00:00 UTC on September 30, 2025.',
    admin_id, 'active', NOW(), '2025-09-30', '2025-10-01',
    0.48, 0.52, 600, 600,
    FALSE, NULL, ARRAY['ethereum', 'ETH', 'crypto'],
    ARRAY['KE', 'TZ', 'UG', 'RW', 'ZM', 'ET', 'BI']
  ),

  -- ========================
  -- TECHNOLOGY
  -- ========================
  (
    'mpesa-1-billion-transactions-2025',
    'Will M-Pesa process over 1 billion transactions in Q3 2025?',
    'M-Pesa is Africa''s leading mobile money platform. Safaricom reports quarterly transaction data.',
    'technology',
    'Resolves YES if Safaricom''s official Q3 2025 results report M-Pesa transactions exceeding 1 billion for the quarter.',
    admin_id, 'active', NOW(), '2025-11-01', '2025-11-30',
    0.55, 0.45, 180, 180,
    FALSE, NULL, ARRAY['mpesa', 'safaricom', 'fintech', 'kenya'],
    ARRAY['KE', 'TZ', 'UG', 'RW', 'ZM', 'ET', 'BI']
  ),

  -- ========================
  -- BUSINESS
  -- ========================
  (
    'safaricom-stock-100-2025',
    'Will Safaricom stock (NSE: SCOM) reach KES 100 by December 2025?',
    'Safaricom is Kenya''s largest company by market cap. Its stock has been recovering from recent lows.',
    'business',
    'Resolves YES if Safaricom PLC (NSE ticker: SCOM) closing price reaches KES 100.00 or above on any trading day in December 2025.',
    admin_id, 'active', NOW(), '2025-12-31', '2026-01-05',
    0.38, 0.62, 350, 350,
    FALSE, NULL, ARRAY['safaricom', 'NSE', 'stocks', 'kenya'],
    ARRAY['KE', 'TZ', 'UG', 'RW', 'ZM', 'ET', 'BI']
  );

  RAISE NOTICE 'Sample markets created successfully.';
END $$;
