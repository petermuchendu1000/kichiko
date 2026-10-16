import sys, os, itertools
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from okabe import SEED, labs_of, WHITE, DARK
from okabe2 import shift, score
from colormath import hex2rgb, ratio, rgb2lab
for theme, surf in (('light', WHITE), ('dark', DARK)):
    print('==', theme)
    for dL in (-15,-10,-5,0,5,10,15,20):
        pal = shift(SEED, dL, surf)
        if any(p is None for p in pal): continue
        w = score(pal, 6)
        mn = min(ratio(hex2rgb(p), surf) for p in pal[:6])
        mnL = min(rgb2lab(hex2rgb(p))[0] for p in pal[:6])
        mxL = max(rgb2lab(hex2rgb(p))[0] for p in pal[:6])
        print('  dL=%+4d  contrast_min %4.2f:1  L* %2.0f-%2.0f  dE normal %5.1f / deut %5.1f / prot %5.1f   %s'
              % (dL, mn, mnL, mxL, w['normal'][0], w['deuteranopia'][0], w['protanopia'][0], pal[:6]))
