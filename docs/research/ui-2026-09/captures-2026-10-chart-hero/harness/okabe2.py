import sys, os, math, itertools
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from okabe import SEED, relight, labs_of, WHITE, DARK
from colormath import hex2rgb, rgb2hex, ratio, rgb2lab, de2000

MODELS = ('normal', 'deuteranopia', 'protanopia')

def shift(seed, dL, surf, floor=3.05):
    """Move the whole set by dL, holding its internal lightness spread. Any
    colour still short of the contrast floor is nudged on its own, as little
    as possible — the spread survives, the failures do not."""
    out = []
    for _, h in seed:
        L0 = rgb2lab(hex2rgb(h))[0]
        L = max(5.0, min(95.0, L0 + dL))
        hx = relight(h, L)
        step = 1.0 if surf is DARK else -1.0
        guard = 0
        while hx and ratio(hex2rgb(hx), surf) < floor and guard < 90:
            L += step; guard += 1
            hx = relight(h, max(5.0, min(95.0, L)))
        out.append(hx)
    return out

def score(pal, n):
    cache = {h: labs_of(h) for h in pal}
    worst = {}
    for mi, m in enumerate(MODELS):
        ds = sorted((de2000(cache[pal[a]][mi], cache[pal[b]][mi]), a+1, b+1)
                    for a, b in itertools.combinations(range(n), 2))
        worst[m] = ds[0]
    return worst

for theme, surf in (('light', WHITE), ('dark', DARK)):
    best = None
    for dL10 in range(-220, 261, 5):
        dL = dL10 / 10
        pal = shift(SEED, dL, surf)
        if any(p is None for p in pal): continue
        if min(ratio(hex2rgb(p), surf) for p in pal) < 3.0: continue
        w = score(pal, 6)
        # objective: worst case across the three vision models, first six slots
        obj = min(v[0] for v in w.values())
        if best is None or obj > best[0]: best = (obj, dL, pal, w)
    obj, dL, pal, w = best
    print('==', theme, ' shift dL=%+.1f  objective(min dE over 3 models, first 6) = %.1f' % (dL, obj))
    for (name, src), out in zip(SEED, pal):
        print('  %-15s %s -> %s   %.2f:1  L*=%.0f' % (name, src, out, ratio(hex2rgb(out), surf), rgb2lab(hex2rgb(out))[0]))
    for m, (d, a, b) in w.items():
        print('     %-13s min dE %5.1f (slots %d/%d)' % (m, d, a, b))
    w8 = score(pal, 8)
    for m, (d, a, b) in w8.items():
        print('     first 8 %-13s min dE %5.1f (slots %d/%d)' % (m, d, a, b))
    print('    ', pal)
