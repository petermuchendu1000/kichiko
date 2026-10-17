// lib/notifications/sms.ts
// SMS copy, and the thin compatibility wrapper over the provider.
//
// The transport moved to lib/notifications/africastalking.ts, which reports
// WHY a send failed and whether retrying can help. This file keeps the message
// bank, because what a payout SMS says is a product decision and does not
// belong next to HTTP plumbing.
import { sendSms, type SmsResult } from '@/lib/notifications/africastalking'

export interface SMSMessage {
  to: string // E.164 phone number e.g. +254700000000
  message: string
}

export type { SmsResult }

/**
 * Send one SMS. Prefer `sendSms` directly where the outcome matters: this
 * returns a bare boolean and so throws away the message id a delivery report
 * arrives under, the cost, and whether the failure is worth retrying.
 */
export async function sendSMS(to: string, message: string): Promise<boolean> {
  const result = await sendSms(to, message)
  return result.ok
}

/**
 * Send to many recipients.
 *
 * One request per recipient, not a comma-separated list, even though Africa's
 * Talking accepts one. A single multi-recipient call returns one array and we
 * would have to unpick which id and which cost belongs to whom to record a
 * per-delivery outcome; getting that wrong attributes a failure to the wrong
 * person's payout.
 */
export async function sendBulkSMS(messages: SMSMessage[]): Promise<number> {
  const results = await Promise.all(messages.map((m) => sendSms(m.to, m.message)))
  return results.filter((r) => r.ok).length
}

// Templated notification helpers.
//
// Kept under 160 GSM-7 characters wherever the inputs allow it. Every
// character past 160 starts a second segment, which is a second charge on
// every message to every user, and these are the high-volume types.
export const SMS_TEMPLATES = {
  deposit_success: (amount: string, currency: string, balance: string) =>
    `Elopis: Deposit of ${amount} ${currency} confirmed. New balance: ${balance} ${currency}. Trade at elopis.com`,

  withdrawal_success: (amount: string, currency: string, phone: string) =>
    `Elopis: ${amount} ${currency} sent to ${phone}. You should receive it shortly.`,

  // No emoji. An emoji is not in GSM-7, so one character forces the whole
  // message into UCS-2 and the segment limit drops from 160 to 70: this SMS
  // was billing as two or three segments for a decoration.
  bet_won: (amount: string, market: string) =>
    `Elopis: You won! Your prediction on "${market}" was correct. +${amount} credited.`,

  market_closing: (market: string, closes: string) =>
    `Elopis: Market "${market}" closes ${closes}. Place your prediction now at elopis.com`,

  kyc_approved: () =>
    `Elopis: Your identity has been verified. You now have full access. Happy predicting!`,

  kyc_rejected: (reason: string) =>
    `Elopis: KYC rejected: ${reason}. Please resubmit at elopis.com/kyc`,

  otp: (code: string) =>
    `Elopis OTP: ${code}. Valid for 10 minutes. Do not share this code.`,
}
