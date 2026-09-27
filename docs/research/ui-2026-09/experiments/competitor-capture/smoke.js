const { chromium } = require('playwright');
(async () => {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  console.log('proxy:', proxy);
  const browser = await chromium.launch({
    proxy: proxy ? { server: proxy } : undefined,
    args: ['--ignore-certificate-errors-spki-list'] // no TLS disabling
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const resp = await page.goto('https://polymarket.com/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  console.log('status:', resp && resp.status());
  console.log('url:', page.url());
  console.log('title:', await page.title());
  await page.waitForTimeout(5000);
  const txt = await page.evaluate(() => document.body.innerText.slice(0, 600));
  console.log('--- body text ---\n' + txt);
  await browser.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
