-- 095_settlement_lock_deferred.sql — a user's first order no longer locks
-- their profile out of order (bug: intermittent 40P01 between takers).
--
-- BUG (reproduced: scripts/ops/clob/test_settlement_lock_order.py, red; and
-- test_deadlock_free.py: 2 deadlocks in 1,800 orders in CI run 635, 5 in 20
-- local runs): trg_lock_settlement_on_order (079) runs AFTER INSERT on
-- clob_orders, and clob_place_order inserts the taker's order before the book
-- walk. On a user's FIRST order (settlement_locked_at still NULL) its UPDATE
-- took a row lock on the user's profile there, outside 081's "wallets, then
-- profiles, each in id order". A concurrent taker on another market that
-- needed that profile (a maker's owner) waited on it while holding a wallet
-- the first taker needed next: a cycle. Every deadlock victim in the server
-- log was waiting inside the ordered wallet/profile lock statements.
--
-- FIX: the same trigger, deferred to commit. By then clob_place_order holds
-- the taker's profile in the ordered phase whenever a maker was touched, so
-- no new lock is taken; with no maker touched it holds only its market row
-- and its own wallet, and a profile lock after a wallet lock respects the
-- global order. The settlement currency is still locked in the transaction
-- that places the first order, for every insert path. The deposit and
-- withdrawal triggers are unchanged: their only earlier row lock is the
-- user's wallet (wallet, then profile: the same order).
BEGIN;

DROP TRIGGER IF EXISTS trg_lock_settlement_on_order ON public.clob_orders;
CREATE CONSTRAINT TRIGGER trg_lock_settlement_on_order
  AFTER INSERT ON public.clob_orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.lock_settlement_currency();

COMMIT;
