"""Tune the Okabe–Ito colour-universal palette to our two chart surfaces.

Okabe & Ito (2008), "Color Universal Design", is the standard qualitative
palette designed to stay distinguishable under the common forms of colour
vision deficiency. Published as-is it does not meet our contrast rule — its
yellow (#F0E442) is 1.2:1 on white and its black is 1.2:1 on our dark surface —
so each hue is re-rendered at the lightness its own surface needs, holding the
Lab hue angle so it stays the same colour, only lighter or darker.

Slot 1 is the brand blue rather than Okabe-Ito's, because the leader line is
brand-carrying; it is tuned the same way (which is what fixes --pip-500's
2.88:1 against the dark surface).
"""
import sys, os, math, itertools
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from colormath import hex2rgb, rgb2hex, ratio, rgb2lab, de2000, cvd, DEUT, PROT

WHITE, DARK = hex2rgb('#FFFFFF'), hex2rgb('#1A1C1F')
MODELS = (None, DEUT, PROT)

# slot order: brand first, then Okabe-Ito ranked so early slots are far apart
SEED = [
    ('brand blue',      '#1452F0'),
    ('vermillion',      '#D55E00'),
    ('bluish green',    '#009E73'),
    ('reddish purple',  '#CC79A7'),
    ('sky blue',        '#56B4E9'),
    ('orange',          '#E69F00'),
    ('blue',            '#0072B2'),
    ('yellow',          '#F0E442'),
]


def lab2rgb(L, a, b):
    def fi(t):
        return t ** 3 if t ** 3 > 0.008856 else (t - 16 / 116) / 7.787
    fy = (L + 16) / 116
    X, Y, Z = 0.95047 * fi(fy + a / 500), 1.0 * fi(fy), 1.08883 * fi(fy - b / 200)
    r = X * 3.2404542 + Y * -1.5371385 + Z * -0.4985314
    g = X * -0.9692660 + Y * 1.8760108 + Z * 0.0415560
    bl = X * 0.0556434 + Y * -0.2040259 + Z * 1.0572252
    def gam(c):
        c = max(0.0, min(1.0, c))
        return 255 * (12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055)
    return (gam(r), gam(g), gam(bl))


def relight(hex_in, target_L):
    """Same hue, new lightness. Chroma is reduced only as far as the sRGB gamut
    forces, so the colour keeps as much of its identity as it can."""
    L0, a0, b0 = rgb2lab(hex2rgb(hex_in))
    hue = math.atan2(b0, a0)
    C0 = math.hypot(a0, b0)
    best = None
    for k in [x / 100 for x in range(100, 29, -2)]:      # chroma scale, high first
        C = C0 * k
        rgb = lab2rgb(target_L, C * math.cos(hue), C * math.sin(hue))
        hx = rgb2hex(rgb)
        back = rgb2lab(hex2rgb(hx))
        # accept once the round trip is faithful (i.e. we are inside the gamut)
        if abs(back[0] - target_L) < 1.2 and abs(math.hypot(back[1], back[2]) - C) < 3.0:
            best = hx
            break
    return best or rgb2hex(lab2rgb(target_L, a0, b0))


def tune(hex_in, surf, band):
    """Smallest move into the band that also clears 3:1 on this surface."""
    lo, hi = band
    cands = []
    for L in [x / 2 for x in range(int(lo * 2), int(hi * 2) + 1)]:
        hx = relight(hex_in, L)
        if hx and ratio(hex2rgb(hx), surf) >= 3.05:
            cands.append((abs(L - rgb2lab(hex2rgb(hex_in))[0]), hx))
    return min(cands)[1] if cands else None


def labs_of(h):
    c = hex2rgb(h)
    return tuple(rgb2lab(c if M is None else cvd(c, M)) for M in MODELS)


for theme, surf, band in (('light', WHITE, (38, 56)), ('dark', DARK, (60, 80))):
    pal = [tune(h, surf, band) for _, h in SEED]
    print('==', theme)
    for (name, src), out in zip(SEED, pal):
        print('  %-15s %s -> %s   %.2f:1   L*=%.0f' % (
            name, src, out, ratio(hex2rgb(out), surf), rgb2lab(hex2rgb(out))[0]))
    cache = {h: labs_of(h) for h in pal}
    for mi, mname in enumerate(('normal', 'deuteranopia', 'protanopia')):
        for n in (6, 8):
            sub = pal[:n]
            ds = sorted((de2000(cache[sub[a]][mi], cache[sub[b]][mi]), a + 1, b + 1)
                        for a, b in itertools.combinations(range(n), 2))
            print('     first %d  %-13s min dE %5.1f (slots %d/%d)' % (n, mname, ds[0][0], ds[0][1], ds[0][2]))
    print('    ', pal)
