/* Reads document-level meta (viewport, theme-color, lang) on the home page, mobile. */
const L = require('./lib');
(async () => {
  const b = await L.launch();
  const ctx = await b.newContext({ ...L.VIEWPORTS.mobile, colorScheme: 'light' }); const p = await ctx.newPage();
  await L.politeGoto(p, 'https://polymarket.com/');
  const m = await p.evaluate(() => ({ viewport: document.querySelector('meta[name=viewport]')?.content, themeColor: Array.from(document.querySelectorAll('meta[name=theme-color]')).map(x => x.content + (x.media ? ' (' + x.media + ')' : '')), lang: document.documentElement.lang, manifest: !!document.querySelector('link[rel=manifest]') }));
  console.log(JSON.stringify(m)); L.writeJson('meta-probe.json', m);
  await b.close();
})();
