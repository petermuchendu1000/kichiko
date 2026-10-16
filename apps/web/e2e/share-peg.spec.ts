// e2e/share-peg.spec.ts
// ---------------------------------------------------------------------------
// One share settles at KSh 100, so the shilling price of an outcome IS its
// probability in percent (migration 113).
//
// WHY THIS IS GATED RATHER THAN TRUSTED
//
// The peg lives in three places that have to agree: `exchange_rates.rate`
// (which the order engine reads), the `trg_fx_apply_share_peg` trigger (which
// stops the FX cron overwriting it on its next cycle), and the hard guard in
// `getUsdRate`. Unit tests cover the third. Nothing covered the other two
// together, and the way this defect originally arrived was precisely a
// disagreement between layers: the ledger was written at 100 for 2,907
// transactions while the display moved to live FX, and the open book — KSh
// 157,401,812 of real user money — was shown as KSh 204,323,293 for months.
// Every position overstated by 29.8%, and no test anywhere said so.
//
// This asserts the invariant on the rendered page, which is the only place all
// three layers meet.
import { test, expect } from '@playwright/test'

const MARKET = `/markets/${process.env.E2E_A11Y_MARKET_SLUG || 'ke-2027-president'}`

/** "KSh 46" -> 46. Returns null for anything that is not a shilling figure. */
function shillings(text: string): number | null {
  const m = text.replace(/,/g, '').match(/KSh\s*([\d.]+)/)
  return m ? Number(m[1]) : null
}

test.describe('the KSh 100 share peg', () => {
  test.slow()

  test('Yes + No sums to one share on every outcome row', async ({ page }) => {
    await page.goto(MARKET, { waitUntil: 'domcontentloaded' })
    await page.locator('button', { hasText: /^Buy Yes/ }).first().waitFor({ timeout: 45_000 })

    const rows = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('button')]
        .map((b) => (b.innerText || '').replace(/\s+/g, ' ').trim())
        .filter((t) => /^Buy (Yes|No) /.test(t))
      const out: { yes: string; no: string }[] = []
      for (let i = 0; i + 1 < labels.length; i += 2) out.push({ yes: labels[i], no: labels[i + 1] })
      return out
    })

    expect(rows.length, 'the board should offer outcomes to price').toBeGreaterThan(0)

    for (const { yes, no } of rows) {
      const y = shillings(yes)
      const n = shillings(no)
      expect(y, `unparsable Yes price: ${yes}`).not.toBeNull()
      expect(n, `unparsable No price: ${no}`).not.toBeNull()
      // Both sides are rounded to whole shillings independently, so the sum can
      // land one shilling either side of the settlement. It summed to 130
      // before the peg, so the tolerance cannot hide a regression.
      expect(
        Math.abs(y! + n! - 100),
        `${yes} + ${no} = ${y! + n!}, which is not one share`,
      ).toBeLessThanOrEqual(1)
    }
  })

  test('the shilling price of an outcome is its percentage', async ({ page }) => {
    await page.goto(MARKET, { waitUntil: 'domcontentloaded' })
    await page.locator('button', { hasText: /^Buy Yes/ }).first().waitFor({ timeout: 45_000 })

    // Pair each row's displayed probability with its own Buy Yes price, by
    // walking the row element rather than zipping two page-wide lists — a zip
    // would pass on a page where both happen to be sorted the same way.
    const pairs = await page.evaluate(() => {
      const out: { pct: number; kes: number }[] = []
      for (const btn of document.querySelectorAll('button')) {
        const label = (btn as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() || ''
        if (!/^Buy Yes /.test(label)) continue
        let row: HTMLElement | null = btn as HTMLElement
        for (let i = 0; i < 6 && row; i++) {
          const text = row.innerText || ''
          const pct = text.match(/(\d{1,3})%/)
          const kes = label.replace(/,/g, '').match(/KSh\s*([\d.]+)/)
          if (pct && kes) { out.push({ pct: Number(pct[1]), kes: Number(kes[1]) }); break }
          row = row.parentElement
        }
      }
      return out
    })

    expect(pairs.length, 'no outcome row carried both a percentage and a price').toBeGreaterThan(0)

    for (const { pct, kes } of pairs) {
      // This is the whole point of the peg. Under live FX a 46% outcome priced
      // at KSh 60; the two numbers sat side by side on the same row saying
      // different things about the same quantity.
      expect(Math.abs(kes - pct), `${pct}% priced at KSh ${kes}`).toBeLessThanOrEqual(1)
    }
  })

  test('the order ticket prices the selected outcome at the same number', async ({ page, isMobile }) => {
    // Desktop only, and not because the assertion is weaker on a phone: at
    // 390px there is no right-rail ticket at all. The money path there is the
    // MobileTradeBar plus the drawer, which mounts the SAME PmTicket with
    // `isSheet` — the price formatting is one code path, and the two row tests
    // above already run on mobile and cover its rendering. Driving the drawer
    // open here would test the drawer, not the peg.
    test.skip(!!isMobile, 'no right-rail ticket at phone width; the drawer mounts the same component')
    await page.goto(MARKET, { waitUntil: 'domcontentloaded' })
    // \s* not \s+: `hasText` matches textContent, where the button's two
    // spans concatenate to "YesKSh 46" with no separator. innerText renders the
    // space; textContent never had one.
    const ticketYes = page.locator('button', { hasText: /^Yes\s*KSh/ }).first()
    await ticketYes.waitFor({ timeout: 45_000 })
    const ticketNo = page.locator('button', { hasText: /^No\s*KSh/ }).first()

    const y = shillings((await ticketYes.innerText()).replace(/\s+/g, ' '))
    const n = shillings((await ticketNo.innerText()).replace(/\s+/g, ' '))
    expect(y, 'ticket Yes price').not.toBeNull()
    expect(n, 'ticket No price').not.toBeNull()
    expect(Math.abs(y! + n! - 100), `ticket reads ${y} + ${n}`).toBeLessThanOrEqual(1)
  })
})
