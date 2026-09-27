"""Pixel cross-check of contrast for labelled interactive elements visible in the fold.
Why: the DOM method composites ancestor backgrounds only, so a label painted over a sibling
layer (e.g. a sliding selected-pill indicator) reads as white-on-white. Here the fold PNG is
sampled inside each element's box (scaled by dpr): background = most frequent colour,
foreground = the most frequent colour among pixels far (>= 60 in RGB distance) from it.
Output: data/pixel-contrast.json. Values are measurements of rendered pixels (anti-aliasing
can only lower the foreground's apparent contrast, so this is a conservative estimate)."""
import json, glob, os
from collections import Counter
from PIL import Image
D = os.path.join(os.path.dirname(__file__), '..', 'data'); S = os.path.join(os.path.dirname(__file__), '..', 'shots')
def lum(c):
    f = lambda v: (v / 255) / 12.92 if v / 255 <= 0.03928 else (((v / 255) + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])
def ratio(a, b):
    la, lb = lum(a), lum(b); return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
hx = lambda c: '#%02X%02X%02X' % c[:3]
out = {}
for f in sorted(glob.glob(os.path.join(D, 'P*_*.json'))):
    tag = os.path.basename(f)[:-5]; d = json.load(open(f)); m = d.get('measure')
    png = os.path.join(S, f'kalshi_{tag}_fold.png')
    if not m or not os.path.exists(png): continue
    im = Image.open(png).convert('RGB'); dpr = m['viewport']['dpr']; vh = m['viewport']['h']
    rows = []
    for i in m['interactive']:
        if not i['label'] or i['top'] < 0 or i['top'] + i['h'] > vh or i['w'] < 12 or i['h'] < 10: continue
        box = tuple(int(v * dpr) for v in (i['x'] + 1, i['top'] + 1, i['x'] + i['w'] - 1, i['top'] + i['h'] - 1))
        if box[2] <= box[0] or box[3] <= box[1]: continue
        px = list(im.crop(box).getdata()); cnt = Counter(px); bg = cnt.most_common(1)[0][0]
        far = Counter({c: n for c, n in cnt.items() if sum((c[k] - bg[k]) ** 2 for k in range(3)) ** .5 >= 60})
        if not far: continue
        fg = far.most_common(1)[0][0]
        rows.append({'label': i['label'][:40], 'kind': i['kind'], 'box': [i['x'], i['top'], i['w'], i['h']], 'radius': i['radius'], 'pixelBg': hx(bg), 'pixelFg': hx(fg), 'pixelRatio': round(ratio(fg, bg), 2), 'domBg': i['bg'], 'domColor': i['color'], 'font': i['font']})
    out[tag] = rows
json.dump(out, open(os.path.join(D, 'pixel-contrast.json'), 'w'), indent=1)
for k, rows in out.items():
    print(k, len(rows), 'elements;', 'below 4.5:', sum(r['pixelRatio'] < 4.5 for r in rows), 'below 3:', sum(r['pixelRatio'] < 3 for r in rows))
