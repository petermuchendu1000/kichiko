-- 094_withdrawal_review_channel_default.sql — channel policy for the
-- 'withdrawal_under_review' notification (093; audit 6.34): email, no SMS
-- (the approval or rejection that follows is sent by SMS as well).
BEGIN;
INSERT INTO public.notification_channel_defaults (type, email, sms)
VALUES ('withdrawal_under_review', TRUE, FALSE)
ON CONFLICT (type) DO NOTHING;
COMMIT;
