"""Re-fetch selected help articles, record every <img> (with alt/caption context) and
every outbound link; download the images (official Kalshi UI screenshots embedded in
Kalshi's own Help Center). 3 s between requests."""
import re, html, json, subprocess, time, sys, os
OUT = '../data/raw/help'; SH = '../shots'
idx = json.load(open(f'{OUT}/index.json'))
res = {}
for slug in sys.argv[1].split(','):
    u = idx[slug]['url']
    body = subprocess.run(['curl', '-sS', '-L', '--max-time', '40', u], capture_output=True, text=True).stdout
    art = (re.search(r'<article.*?</article>', body, re.S) or re.search(r'.*', body, re.S)).group(0)
    imgs = re.findall(r'<img[^>]+src="([^"]+)"[^>]*>', art)
    links = sorted(set(html.unescape(l) for l in re.findall(r'<a[^>]+href="([^"]+)"', art)))
    res[slug] = {'url': u, 'images': [], 'links': links}
    time.sleep(3)
    for i, src in enumerate(imgs, 1):
        src = html.unescape(src)
        if 'intercom' not in src and 'kalshi' not in src: continue
        ext = (re.search(r'\.(png|jpe?g|gif|webp)', src.split('?')[0], re.I) or [None, 'png'])[1].lower()
        fn = f'kalshi_HELP_{slug.split("-",1)[1][:40]}_{i:02d}.{ext}'
        r = subprocess.run(['curl', '-sS', '-L', '--max-time', '60', '-o', f'{SH}/{fn}', '-w', '%{http_code} %{size_download} %{content_type}', src], capture_output=True, text=True).stdout
        res[slug]['images'].append({'src': src, 'file': fn, 'fetch': r})
        print(slug, fn, r, flush=True)
        time.sleep(3)
    json.dump(res, open(f'{OUT}/images-and-links.json', 'w'), indent=1)
