-- Minimal repro: the post-match "market-sell dust guard" ([043 #4], 071 L512-515)
-- also rejects LIMIT sells. A $60 limit sell (well above min_order_size $5)
-- whose immediate fill happens to be small ($0.60) is rejected ENTIRELY with
-- P0105 instead of filling 1 share and resting 99. Local replica only; ROLLBACK.
BEGIN;
SELECT set_config('repro.m', gen_random_uuid()::text, true), set_config('repro.o', gen_random_uuid()::text, true);
CREATE TEMP TABLE u ON COMMIT DROP AS
  SELECT (array_agg(id ORDER BY display_name))[1] seller, (array_agg(id ORDER BY display_name))[2] bidder,
         (array_agg(id ORDER BY display_name))[3] other
  FROM profiles WHERE display_name LIKE 'CLOB CI %';
INSERT INTO wallets(user_id,currency,available_balance,is_active) SELECT x,'USD',1000,true FROM u, unnest(array[seller,bidder,other]) x
  ON CONFLICT (user_id,currency) DO UPDATE SET available_balance=1000, reserved_balance=0;
INSERT INTO markets(id,slug,title,description,creator_id,closes_at,resolution_criteria,status,resolution_type,pricing_engine,
                    options_pricing_mode,tick_size,min_order_size,opens_at,platform_fee_rate)
  SELECT current_setting('repro.m')::uuid,'repro-'||left(current_setting('repro.m'),8),'r','r',seller,now()+interval '1 day','r','active',
         'multiple_choice','clob','independent',0.01,5.00,now()-interval '1 day',0 FROM u;
INSERT INTO market_options(id,market_id,label,display_order,is_active)
  VALUES (current_setting('repro.o')::uuid, current_setting('repro.m')::uuid,'A',0,true);
-- seller and other hold 100 YES shares each (test fixture)
INSERT INTO positions(user_id,market_id,wallet_id,market_option_id,side,shares,total_invested_usd,avg_entry_price)
  SELECT x, current_setting('repro.m')::uuid, (SELECT id FROM wallets w WHERE w.user_id=x AND currency='USD'),
         current_setting('repro.o')::uuid,'yes',100,50,0.5 FROM u, unnest(array[seller,other]) x;
-- 1) bidder rests BUY YES 10 @ 60c ($6.00 >= $5 min)
SELECT clob_place_order(bidder, current_setting('repro.m')::uuid, current_setting('repro.o')::uuid,'yes','buy','limit',60,10,'USD')->>'status' AS bid FROM u;
-- 2) other sells 9 @ 60c ($5.40) -> bid has 1 share left
SELECT clob_place_order(other, current_setting('repro.m')::uuid, current_setting('repro.o')::uuid,'yes','sell','limit',60,9,'USD')->>'status' AS s1 FROM u;
-- 3) seller: LIMIT SELL 100 @ 60c ($60 notional). Expected: fill 1, rest 99.
SAVEPOINT a;
DO $$ DECLARE r jsonb; BEGIN
  SELECT clob_place_order(seller, current_setting('repro.m')::uuid, current_setting('repro.o')::uuid,'yes','sell','limit',60,100,'USD') INTO r FROM u;
  RAISE NOTICE 'limit sell accepted: %', r->>'status';
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'limit sell REJECTED: SQLSTATE % - %', SQLSTATE, SQLERRM; END $$;
ROLLBACK TO a;
-- 4) same order after the 1-share bid is gone would rest normally (control): cancel bid, retry
SELECT clob_cancel_order(bidder, (SELECT id FROM clob_orders WHERE market_id=current_setting('repro.m')::uuid AND user_id=u.bidder)) ->>'success' AS cancelled FROM u;
DO $$ DECLARE r jsonb; BEGIN
  SELECT clob_place_order(seller, current_setting('repro.m')::uuid, current_setting('repro.o')::uuid,'yes','sell','limit',60,100,'USD') INTO r FROM u;
  RAISE NOTICE 'control (no crossing bid): %', r->>'status';
END $$;
ROLLBACK;
