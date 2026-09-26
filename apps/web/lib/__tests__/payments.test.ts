import { describe, it, expect } from 'vitest'
import { parseMpesaCallback, formatMpesaPhone } from '@/lib/payments/mpesa'
import { parseAirtelCallback, formatAirtelPhone } from '@/lib/payments/airtel-money'
import { parsePesaPalIpn } from '@/lib/payments/pesapal'

describe('parseMpesaCallback', () => {
  it('parses a successful STK callback with metadata', () => {
    const body = {
      Body: {
        stkCallback: {
          MerchantRequestID: 'm-1',
          CheckoutRequestID: 'c-1',
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 100 },
              { Name: 'MpesaReceiptNumber', Value: 'QABC123' },
              { Name: 'TransactionDate', Value: 20260630120000 },
              { Name: 'PhoneNumber', Value: 254712345678 },
            ],
          },
        },
      },
    }
    const r = parseMpesaCallback(body)
    expect(r.success).toBe(true)
    expect(r.checkoutRequestId).toBe('c-1')
    expect(r.amount).toBe(100)
    expect(r.mpesaReceiptNumber).toBe('QABC123')
  })

  it('parses a failed/cancelled callback (non-zero ResultCode)', () => {
    const body = {
      Body: {
        stkCallback: {
          MerchantRequestID: 'm-2',
          CheckoutRequestID: 'c-2',
          ResultCode: 1032,
          ResultDesc: 'Request cancelled by user',
        },
      },
    }
    const r = parseMpesaCallback(body)
    expect(r.success).toBe(false)
    expect(r.resultCode).toBe(1032)
    expect(r.mpesaReceiptNumber).toBeUndefined()
  })
})

describe('formatMpesaPhone', () => {
  it('normalises common Kenyan formats to 2547XXXXXXXX', () => {
    expect(formatMpesaPhone('0712345678')).toBe('254712345678')
    expect(formatMpesaPhone('254712345678')).toBe('254712345678')
    expect(formatMpesaPhone('712345678')).toBe('254712345678')
  })
  it('throws on garbage input', () => {
    expect(() => formatMpesaPhone('123')).toThrow()
  })
})

describe('formatAirtelPhone', () => {
  it('prefixes per country', () => {
    expect(formatAirtelPhone('0712345678', 'KE')).toBe('254712345678')
    expect(formatAirtelPhone('0772345678', 'UG')).toBe('256772345678')
    expect(formatAirtelPhone('250788123456', 'RW')).toBe('250788123456')
  })
})

describe('parseAirtelCallback', () => {
  it('flags TS as success and TF as failed', () => {
    const ok = parseAirtelCallback({ transaction: { id: 'ref-1', status_code: 'TS', airtel_money_id: 'AM1' } })
    expect(ok.success).toBe(true)
    expect(ok.failed).toBe(false)
    expect(ok.reference).toBe('ref-1')
    expect(ok.airtelMoneyId).toBe('AM1')

    const bad = parseAirtelCallback({ transaction: { id: 'ref-2', status_code: 'TF' } })
    expect(bad.failed).toBe(true)
    expect(bad.success).toBe(false)
  })
  it('treats unknown codes as pending and reads nested data', () => {
    const p = parseAirtelCallback({ data: { transaction: { id: 'ref-3', status_code: 'TIP' } } })
    expect(p.pending).toBe(true)
    expect(p.reference).toBe('ref-3')
  })
})

describe('parsePesaPalIpn', () => {
  it('reads v3 query params', () => {
    const q = new URLSearchParams({
      OrderTrackingId: 'otid-1',
      OrderMerchantReference: 'dep-1',
      OrderNotificationType: 'IPNCHANGE',
    })
    const r = parsePesaPalIpn({ query: q })
    expect(r.orderTrackingId).toBe('otid-1')
    expect(r.merchantReference).toBe('dep-1')
    expect(r.notificationType).toBe('IPNCHANGE')
  })
  it('falls back to POST body and legacy keys', () => {
    const r = parsePesaPalIpn({ body: { pesapal_transaction_tracking_id: 'otid-2', pesapal_merchant_reference: 'dep-2' } })
    expect(r.orderTrackingId).toBe('otid-2')
    expect(r.merchantReference).toBe('dep-2')
  })
})
