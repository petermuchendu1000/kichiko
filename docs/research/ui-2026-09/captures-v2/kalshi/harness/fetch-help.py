"""Fetch selected Kalshi Help Center articles (help.kalshi.com, live) and store
plain text + lastmod from the sitemap. Polite: 3 s between requests. Grade M3."""
import re, html, json, subprocess, time, sys, os
OUT = '../data/raw/help'
want = sys.argv[1].split(',')
sm = open(f'{OUT}/sitemap.xml').read()
lastmod = dict(re.findall(r'<loc>([^<]+)</loc>\s*<lastmod>([^<]+)</lastmod>', sm))
urls = [l.strip() for l in open(f'{OUT}/sitemap-en.txt') if any(w in l for w in want)]
idx = json.load(open(f'{OUT}/index.json')) if os.path.exists(f'{OUT}/index.json') else {}
for u in urls:
    slug = u.rsplit('/', 1)[1]
    if slug in idx: continue
    r = subprocess.run(['curl', '-sS', '-L', '--max-time', '40', '-w', '\n%{http_code}', u], capture_output=True, text=True)
    body, code = r.stdout.rsplit('\n', 1)
    title = html.unescape((re.search(r'<title>(.*?)</title>', body, re.S) or [None, ''])[1]).strip()
    m = re.search(r'<article.*?</article>', body, re.S) or re.search(r'<div[^>]+class="[^"]*article[^"]*".*', body, re.S)
    frag = m.group(0) if m else body
    frag = re.sub(r'<script.*?</script>|<style.*?</style>|<svg.*?</svg>', '', frag, flags=re.S)
    frag = re.sub(r'<(br|/p|/li|/h\d|/div|/tr)[^>]*>', '\n', frag)
    frag = re.sub(r'<li[^>]*>', '\n- ', frag)
    text = html.unescape(re.sub(r'<[^>]+>', ' ', frag))
    text = '\n'.join(re.sub(r'[ \t]+', ' ', l).strip() for l in text.split('\n'))
    text = re.sub(r'\n{3,}', '\n\n', text).strip()
    upd = re.search(r'Updated\s+([^<\n]{3,40})', body)
    fetched = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    open(f'{OUT}/{slug}.txt', 'w').write(f'URL: {u}\nHTTP: {code}\nFetched: {fetched}\nSitemap lastmod: {lastmod.get(u)}\nTitle: {title}\n\n{text}\n')
    idx[slug] = {'url': u, 'http': code, 'fetched': fetched, 'lastmod': lastmod.get(u), 'title': title, 'chars': len(text)}
    print(code, len(text), slug, flush=True)
    json.dump(idx, open(f'{OUT}/index.json', 'w'), indent=1)
    time.sleep(3)
