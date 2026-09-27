"""Pixel-diff interaction-state crops (rest vs hover vs focus) -> data/pixeldiff.json.
Counts pixels whose max channel delta is >0 and >16 (16/255 ~ just-noticeable on most displays)."""
import json, glob, os
from PIL import Image, ImageChops
S = os.path.join(os.path.dirname(__file__), '..', 'shots'); out = {}
for rest in sorted(glob.glob(os.path.join(S, '*-hf-*-rest.png'))):
    key = os.path.basename(rest).replace('-rest.png', '')
    a = Image.open(rest).convert('RGB'); out[key] = {'size': a.size}
    for st in ('hover', 'focus'):
        p = rest.replace('-rest.png', f'-{st}.png')
        if not os.path.exists(p): continue
        b = Image.open(p).convert('RGB')
        if a.size != b.size: out[key][st] = {'error': 'size differs'}; continue
        d = list(ImageChops.difference(a, b).get_flattened_data() if hasattr(Image.Image, 'get_flattened_data') else ImageChops.difference(a, b).getdata())
        m = [max(px) for px in d]
        out[key][st] = {'changedAny': sum(1 for v in m if v > 0), 'changedGt16': sum(1 for v in m if v > 16), 'maxDelta': max(m), 'total': len(m)}
json.dump(out, open(os.path.join(S, '..', 'data', 'pixeldiff.json'), 'w'), indent=1)
for k, v in out.items(): print(k, {s: (v[s].get('changedGt16'), v[s].get('maxDelta')) for s in ('hover', 'focus') if s in v})
