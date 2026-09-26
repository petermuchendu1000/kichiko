-- 093_notification_type_withdrawal_review.sql — a notification type for a
-- withdrawal held for review (audit 6.34).
--
-- BUG: the withdraw route sent "Withdrawal Under Review" as type
-- 'withdrawal_completed', so it followed the completed-payout channel policy
-- (email + SMS), the user's "withdrawal completed" preference, and showed as
-- a completed payout in the app.
-- A new enum value cannot be used in the transaction that adds it, so its
-- channel default is set in 094.
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'withdrawal_under_review';
