// lib/notifications/email.ts
// Email via Resend (https://resend.com)

export interface EmailOptions {
  to: string
  subject: string
  html: string
  text?: string
  from?: string
}

export async function sendEmail(opts: EmailOptions): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[Email] RESEND_API_KEY not set — skipping email')
    return false
  }

  const from = opts.from || process.env.RESEND_FROM_EMAIL || 'Kichiko <noreply@kichiko.co.ke>'

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error('[Email] Resend error:', res.status, text)
      return false
    }

    return true
  } catch (err) {
    console.error('[Email] Exception:', err)
    return false
  }
}

// HTML email templates
function baseTemplate(content: string) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width"/>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; margin:0; padding:0; }
    .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #f59e0b 0%, #ef4444 100%); padding: 32px 24px; text-align: center; }
    .header h1 { color: #fff; margin: 0; font-size: 24px; }
    .header p { color: rgba(255,255,255,0.85); margin: 4px 0 0; font-size: 14px; }
    .body { padding: 24px; }
    .footer { background: #f1f5f9; padding: 16px 24px; text-align: center; font-size: 12px; color: #94a3b8; }
    .btn { display: inline-block; background: #f59e0b; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; }
    .stat { background: #f8fafc; border-radius: 8px; padding: 12px; margin: 8px 0; }
    .amount { font-size: 28px; font-weight: bold; color: #10b981; }
  </style>
</head>
<body>
<div style="padding:20px">
<div class="container">
  <div class="header">
    <h1>🎯 Kichiko</h1>
    <p>East Africa's Prediction Market</p>
  </div>
  <div class="body">${content}</div>
  <div class="footer">
    &copy; 2025 Kichiko &bull; <a href="https://kichiko.co.ke/unsubscribe">Unsubscribe</a>
  </div>
</div>
</div>
</body>
</html>`
}

export const EMAIL_TEMPLATES = {
  deposit_success: (name: string, amount: string, currency: string, balance: string) => ({
    subject: `✅ Deposit Confirmed — ${amount} ${currency}`,
    html: baseTemplate(`
      <h2>Hi ${name},</h2>
      <p>Your deposit has been confirmed!</p>
      <div class="stat">
        <div class="amount">${amount} ${currency}</div>
        <p style="margin:4px 0 0; color:#64748b; font-size:14px">New balance: ${balance} ${currency}</p>
      </div>
      <p>You're ready to trade. Browse open markets and make your predictions.</p>
      <a href="https://kichiko.co.ke/markets" class="btn">Browse Markets →</a>
    `),
  }),

  bet_won: (name: string, payout: string, market: string) => ({
    subject: `🎉 You Won! +${payout}`,
    html: baseTemplate(`
      <h2>Congratulations ${name}!</h2>
      <p>Your prediction was correct:</p>
      <div class="stat">
        <p style="font-weight:600">${market}</p>
        <div class="amount">+${payout}</div>
      </div>
      <p>Your winnings have been credited to your wallet.</p>
      <a href="https://kichiko.co.ke/portfolio" class="btn">View Portfolio →</a>
    `),
  }),

  market_resolved: (name: string, market: string, outcome: string, won: boolean) => ({
    subject: `${won ? '🎉 You Won' : '📉 Result'}: ${market}`,
    html: baseTemplate(`
      <h2>Hi ${name},</h2>
      <p>A market you participated in has been resolved:</p>
      <div class="stat">
        <p style="font-weight:600">${market}</p>
        <p>Outcome: <strong>${outcome.toUpperCase()}</strong></p>
        <p style="color:${won ? '#10b981' : '#ef4444'};font-weight:600">${won ? '🎉 You predicted correctly!' : '📉 Your prediction was incorrect this time.'}</p>
      </div>
      <a href="https://kichiko.co.ke/portfolio" class="btn">View Results →</a>
    `),
  }),

  kyc_approved: (name: string) => ({
    subject: '✅ Identity Verified — Kichiko',
    html: baseTemplate(`
      <h2>Hi ${name},</h2>
      <p>Your identity has been verified! 🎉</p>
      <p>You now have full access to Kichiko, including higher deposit and withdrawal limits.</p>
      <a href="https://kichiko.co.ke/markets" class="btn">Start Predicting →</a>
    `),
  }),

  kyc_rejected: (name: string, reason: string) => ({
    subject: '⛔ KYC Rejected — Action Required',
    html: baseTemplate(`
      <h2>Hi ${name},</h2>
      <p>We were unable to verify your identity:</p>
      <div class="stat" style="border-left:3px solid #ef4444">
        <p style="color:#ef4444;margin:0">${reason}</p>
      </div>
      <p>Please resubmit your documents with clear, legible photos.</p>
      <a href="https://kichiko.co.ke/kyc" class="btn">Resubmit Documents →</a>
    `),
  }),

  welcome: (name: string, referralCode: string) => ({
    subject: '🎯 Welcome to Kichiko!',
    html: baseTemplate(`
      <h2>Welcome, ${name}!</h2>
      <p>You've joined East Africa's leading prediction market. Trade on real-world outcomes using M-Pesa, MTN MoMo, and Airtel Money.</p>
      <h3>Get Started:</h3>
      <ol>
        <li>Deposit funds via mobile money</li>
        <li>Browse open markets</li>
        <li>Make your first prediction</li>
        <li>Win!</li>
      </ol>
      <div class="stat">
        <p style="margin:0;font-size:14px">Your referral code:</p>
        <p style="font-size:20px;font-weight:bold;margin:4px 0">${referralCode}</p>
        <p style="margin:0;font-size:12px;color:#64748b">Share it and earn bonuses</p>
      </div>
      <a href="https://kichiko.co.ke/markets" class="btn">Browse Markets →</a>
    `),
  }),
}
