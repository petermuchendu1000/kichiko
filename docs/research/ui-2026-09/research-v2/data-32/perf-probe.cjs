// Run from apps/web (needs playwright-core and /opt/pw-browsers Chromium): node <path>/perf-probe.cjs <url> [slow4g]
const { chromium } = require('playwright-core');
(async () => {
  const [,, url, throttle] = process.argv;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'], proxy:{server: process.env.HTTPS_PROXY} });
  const ctx = await b.newContext({ viewport:{width:360,height:800}, deviceScaleFactor:2, isMobile:true, hasTouch:true, userAgent:'Mozilla/5.0 (Linux; Android 14; SM-A075F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' });
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  const reqs = new Map();
  cdp.on('Network.responseReceived', e => { reqs.set(e.requestId, {url:e.response.url, type:e.type, mime:e.response.mimeType, enc:0}); });
  cdp.on('Network.loadingFinished', e => { const r=reqs.get(e.requestId); if(r) r.enc=e.encodedDataLength; });
  if (throttle==='slow4g') {
    await cdp.send('Network.emulateNetworkConditions', {offline:false, latency:150*3.75, downloadThroughput:1.6*1024*1024/8*0.9, uploadThroughput:750*1024/8*0.9});
    await cdp.send('Emulation.setCPUThrottlingRate', {rate:4});
  }
  await p.addInitScript(() => { window.__lcp=0; new PerformanceObserver(l=>{ for (const e of l.getEntries()) window.__lcp=e.startTime; }).observe({type:'largest-contentful-paint', buffered:true}); });
  const t0=Date.now();
  try { await p.goto(url, {waitUntil:'load', timeout: 120000}); } catch(e) { console.log('goto', e.message.slice(0,80)); }
  await p.waitForTimeout(throttle==='slow4g'?15000:8000);
  const lcp = await p.evaluate(()=>window.__lcp).catch(()=>null);
  const nav = await p.evaluate(()=>{const n=performance.getEntriesByType('navigation')[0]; return n?{ttfb:n.responseStart, dcl:n.domContentLoadedEventEnd, load:n.loadEventEnd}:null}).catch(()=>null);
  const agg={};
  for (const r of reqs.values()) { const k=r.type||'Other'; agg[k]=agg[k]||{n:0,kb:0}; agg[k].n++; agg[k].kb+=r.enc/1024; }
  const total=Object.values(agg).reduce((a,x)=>a+x.kb,0);
  console.log(JSON.stringify({url, throttle:throttle||'none', lcp_ms:lcp&&Math.round(lcp), nav, total_kb:Math.round(total), requests:reqs.size, byType:Object.fromEntries(Object.entries(agg).map(([k,v])=>[k,{n:v.n,kb:Math.round(v.kb)}]))}));
  await b.close();
})();
