# SMS (Africa's Talking)

Covers Kenya, Uganda, Tanzania, Rwanda, Zambia, Ethiopia and Burundi. Migrations
`124_sms_delivery_reports.sql` and `125_phone_e164.sql`.

## Flow

```
notifications row
   |  trigger enqueue_notification_deliveries()
   v
notification_deliveries (channel='sms', destination = profiles.phone_number)
   |  cron GET/POST /api/cron/send-notifications
   v
sendSms()  ->  api.africastalking.com/version1/messaging
   |                                   |
   | statusCode -> ok / permanent      | messageId stored
   v                                   v
complete_notification_delivery()   POST /api/webhooks/africastalking/dlr
                                       |
                                   record_sms_delivery_report()
```

## Environment

| Variable | Notes |
|---|---|
| `AFRICASTALKING_USERNAME` | The literal `sandbox` selects the sandbox host. Anything else is live. |
| `AFRICASTALKING_API_KEY` | Server only. |
| `AFRICASTALKING_SENDER_ID` | **Leave empty until registered.** |
| `AFRICASTALKING_WEBHOOK_SECRET` | Delivery-report callback token. |

Register the callback in the AT dashboard as:

```
https://elopis.com/api/webhooks/africastalking/dlr?token=<AFRICASTALKING_WEBHOOK_SECRET>
```

AT does not sign delivery reports and cannot send a custom header, so the
secret in the URL is the only control. The route **fails closed**: 401 without
it, so reports keep being retried rather than being accepted from anyone.

## Four bugs this replaced

1. **`statusCode === 101` was the only success.** `102 Queued` is normal when a
   telco is buffering and `100 Processed` is normal too. Both were reported as
   failures, so the outbox retried, and a recipient could get the same
   "KES 4,000 sent to 0712…" SMS up to five times.

2. **Every failure looked the same.** `403 InvalidPhoneNumber` was retried on
   the same schedule as `501 GatewayError`: five attempts over eight hours
   against a number that will never exist. `AT_STATUS` now carries a
   `permanent` flag and the outbox stops on the first attempt. `405
   InsufficientBalance` is deliberately **not** permanent, and logs at `error`
   because it silently stops all platform SMS until someone tops up.

3. **The messageId was dropped**, so `provider_message_id` was always NULL and
   a delivery report had nothing to match.

4. **No timeout.** The worker has 60 seconds and claims up to 500 deliveries;
   one hung socket stalled the batch. Now 10s per send.

## Phone numbers

`profiles.phone_number` is free text written by three screens, and the KYC
wizard's own placeholder was `+254 7XX XXX XXX`, spaces included. The outbox
copies that column into `destination` and the worker rejects anything failing
`^\+[1-9]\d{7,14}$` as permanently invalid. So a user who typed their number
the way we showed them, or the way every Kenyan writes it, would never have
received a payout SMS and nothing would have looked broken.

Normalisation now happens in two places because it has to: RLS lets a user
PATCH their own profile row directly, so `public.normalize_phone_e164()` and
its trigger are the rule, and `lib/notifications/phone.ts` is for the UI's
feedback and for rescuing rows enqueued before the trigger existed.

Two implementations drift, so they share one case list and a check:

```
SUPABASE_PROJECT_REF=... SUPABASE_ACCESS_TOKEN=... \
  node apps/web/scripts/check-phone-parity.mjs
```

A number that cannot be placed is **not guessed at**. SQL returns it unchanged,
TypeScript returns null, and the worker rejects it. An SMS carrying a balance
sent to an invented number is worse than one not sent.

## Delivery reports are the only proof

`101 Sent` means the telco accepted the message, not that a handset saw it.
Only a `Success` report sets `delivered_at`. `Buffered` and `Sent` are not
outcomes and change nothing.

A `Failed` report marks the delivery failed but never re-queues it: the message
was accepted and billed, and sending it again because a handset was off would
double-send a payout confirmation.

## Still open

- **Nobody verifies the phone number.** `SMS_TEMPLATES.otp` exists and has no
  caller. We send balances and payout confirmations to a number the user typed
  and never proved. Didit's workflow builder has a phone-verification node, or
  an OTP round through this transport would do it.
- Sender ID is unset, so messages go from the shared short code until an
  alphanumeric ID is registered and approved.
