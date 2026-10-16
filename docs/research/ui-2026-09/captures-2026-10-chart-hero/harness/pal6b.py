import sys, os, math, itertools, colorsys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from colormath import hex2rgb, rgb2hex, ratio, rgb2lab, de2000, cvd, DEUT, PROT

WHITE, DARK = hex2rgb('#FFFFFF'), hex2rgb('#1A1C1F')
MODELS = (None, DEUT, PROT)
W = (1.0, 1.9, 1.9)   # CVD separation is a floor, not the objective


def labs_of(h):
    c = hex2rgb(h)
    return tuple(rgb2lab(c if M is None else cvd(c, M)) for M in MODELS)


def grid(surf, lstar):
    """HSL grid kept where the colour clears 3:1 on its own surface AND sits
    in a narrow CIE L* band. The band is what makes the result a palette rather
    than a merely-separable set: equal perceived lightness means no series
    shouts over another, and with L* fixed, maximising dE2000 spreads hue and
    chroma, which is exactly the axis a reader uses to tell lines apart."""
    lo, hi = lstar
    out = []
    for hd in range(0, 360, 2):
        for s in (0.45, 0.55, 0.65, 0.75, 0.85, 0.95, 1.0):
            for l in [x / 100 for x in range(20, 85, 2)]:
                r, g, b = colorsys.hls_to_rgb(hd / 360, l, s)
                hx = rgb2hex((r * 255, g * 255, b * 255))
                c = hex2rgb(hx)
                if ratio(c, surf) < 3.0:
                    continue
                lab = rgb2lab(c)
                if not (lo <= lab[0] <= hi):
                    continue
                if math.hypot(lab[1], lab[2]) < 28:
                    continue
                out.append(hx)
    return sorted(set(out))


def minsep(labsets):
    worst = 1e9
    for mi, w in enumerate(W):
        for a, b in itertools.combinations(range(len(labsets)), 2):
            d = de2000(labsets[a][mi], labsets[b][mi]) * w
            if d < worst:
                worst = d
    return worst


def solve(pin, pool, n=6):
    cache = {h: labs_of(h) for h in pool + pin}
    cur = list(pin)
    # greedy max-min seeding
    while len(cur) < n:
        best, bv = None, -1
        for h in pool:
            if h in cur:
                continue
            v = minsep([cache[x] for x in cur + [h]])
            if v > bv:
                best, bv = h, v
        cur.append(best)
    # local search over the free slots only
    improved = True
    while improved:
        improved = False
        for i in range(len(pin), n):
            base = minsep([cache[x] for x in cur])
            for h in pool:
                if h in cur:
                    continue
                cand = cur[:]
                cand[i] = h
                v = minsep([cache[x] for x in cand])
                if v > base + 1e-9:
                    cur, base, improved = cand, v, True
    return cur, cache


def report(theme, pal, cache, surf):
    print('==', theme)
    for i, h in enumerate(pal, 1):
        print('  %2d %s   vs surface %.2f:1' % (i, h, ratio(hex2rgb(h), surf)))
    for mi, name in enumerate(('normal', 'deuteranopia', 'protanopia')):
        ds = sorted((de2000(cache[pal[a]][mi], cache[pal[b]][mi]), a + 1, b + 1)
                    for a, b in itertools.combinations(range(len(pal)), 2))
        print('     %-13s min dE %5.1f (slots %d/%d)   next %.1f' % (name, ds[0][0], ds[0][1], ds[0][2], ds[1][0]))
    print('    ', pal)


for theme, pin, surf, band in (('light', ['#1452F0'], WHITE, (40, 56)),
                               ('dark', ['#4E7DF3'], DARK, (58, 78))):
    pool = grid(surf, band)
    pal, cache = solve(pin, pool)
    print(theme, 'pool', len(pool))
    report(theme, pal, cache, surf)
