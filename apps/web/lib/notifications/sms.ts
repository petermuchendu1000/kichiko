// lib/notifications/sms.ts
// SMS via Africa's Talking API (covers Kenya, Uganda, Tanzania, Rwanda, etc.)

export interface SMSMessage {
  to: string    // E.164 phone number e.g. +254700000000
  message: string
}

interface ATResponse {
  SMSMessageData?: {
    Recipients?: Array<{
      statusCode: number
      status: string
      number: string
      cost: string
      messageId: string
    }>
  }
}

export async function sendSMS(to: string, message: string): Promise<boolean> {
  const apiKey = process.env.AFRICASTALKING_API_KEY
  const username = process.env.AFRICASTALKING_USERNAME || 'sandbox'
  const from = process.env.AFRICASTALKING_SENDER_ID || 'Kichiko'

  if (!apiKey) {
    console.warn('[SMS] AFRICASTALKING_API_KEY not set — skipping SMS')
    return false
  }

  const isSandbox = username === 'sandbox'
  const baseUrl = isSandbox
    ? 'https://api.sandbox.africastalking.com/version1/messaging'
    : 'https://api.africastalking.com/version1/messaging'

  try {
    const params = new URLSearchParams({
      username,
      to,
      message,
      ...(from ? { from } : {}),
    })

    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'apiKey': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: params.toString(),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('[SMS] Africa\'s Talking error:', res.status, text)
      return false
    }

    const data: ATResponse = await res.json()
    const recipients = data?.SMSMessageData?.Recipients || []
    const success = recipients.some((r) => r.statusCode === 101)

    if (!success) {
      console.error('[SMS] Delivery failed:', recipients)
    }

    return success
  } catch (err) {
    console.error('[SMS] Exception:', err)
    return false
  }
}

export async function sendBulkSMS(messages: SMSMessage[]): Promise<number> {
  const results = await Promise.all(messages.map((m) => sendSMS(m.to, m.message)))
  return results.filter(Boolean).length
}

// Templated notification helpers
export const SMS_TEMPLATES = {
  deposit_success: (amount: string, currency: string, balance: string) =>
    `Kichiko: Deposit of ${amount} ${currency} confirmed. New balance: ${balance} ${currency}. Trade at kichiko.co.ke`,

  withdrawal_success: (amount: string, currency: string, phone: string) =>
    `Kichiko: ${amount} ${currency} sent to ${phone}. You should receive it shortly.`,

  bet_won: (amount: string, market: string) =>
    `🎉 Kichiko: You won! Your prediction on "${market}" was correct. +${amount} credited.`,

  market_closing: (market: string, closes: string) =>
    `Kichiko: Market "${market}" closes ${closes}. Place your prediction now at kichiko.co.ke`,

  kyc_approved: () =>
    `Kichiko: Your identity has been verified. You now have full access. Happy predicting!`,

  kyc_rejected: (reason: string) =>
    `Kichiko: KYC rejected: ${reason}. Please resubmit at kichiko.co.ke/kyc`,

  otp: (code: string) =>
    `Kichiko OTP: ${code}. Valid for 10 minutes. Do not share this code.`,
}
