"""Pick a 12-slot categorical series palette.

Constraints, all of which the current palette breaks somewhere:
  1. >= 3:1 against BOTH surfaces (#FFFFFF light, #1A1C1F dark)  [WCAG 1.4.11]
  2. pairwise CIEDE2000 >= TARGET in both themes
  3. the same, after simulating deuteranopia and protanopia (Brettel/Vienot)
Slots 1 and 2 are pinned to the brand tokens --pip-500 / --yes, which resolve
differently per theme, so each theme is scored on its own resolved list.
"""
import math, random, itertools

def hex2rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def rgb2hex(c):
    return '#%02x%02x%02x' % tuple(max(0, min(255, int(round(v)))) for v in c)
def lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def lum(rgb):
    r, g, b = (lin(v) for v in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
def ratio(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)

def rgb2lab(rgb):
    r, g, b = (lin(v) for v in rgb)
    X = r*0.4124564 + g*0.3575761 + b*0.1804375
    Y = r*0.2126729 + g*0.7151522 + b*0.0721750
    Z = r*0.0193339 + g*0.1191920 + b*0.9503041
    def f(t): return t ** (1/3) if t > 0.008856 else (7.787 * t + 16/116)
    fx, fy, fz = f(X/0.95047), f(Y/1.0), f(Z/1.08883)
    return (116*fy - 16, 500*(fx - fy), 200*(fy - fz))

def de2000(l1, l2):
    L1,a1,b1 = l1; L2,a2,b2 = l2
    C1, C2 = math.hypot(a1,b1), math.hypot(a2,b2); Cb = (C1+C2)/2
    G = 0.5*(1-math.sqrt(Cb**7/(Cb**7+25**7))) if Cb > 0 else 0
    a1p, a2p = (1+G)*a1, (1+G)*a2
    C1p, C2p = math.hypot(a1p,b1), math.hypot(a2p,b2)
    h1p = math.degrees(math.atan2(b1,a1p)) % 360
    h2p = math.degrees(math.atan2(b2,a2p)) % 360
    dLp, dCp = L2-L1, C2p-C1p
    dhp = 0 if C1p*C2p == 0 else ((h2p-h1p+180) % 360 - 180)
    dHp = 2*math.sqrt(C1p*C2p)*math.sin(math.radians(dhp)/2)
    Lbp, Cbp = (L1+L2)/2, (C1p+C2p)/2
    if C1p*C2p == 0: hbp = h1p+h2p
    elif abs(h1p-h2p) <= 180: hbp = (h1p+h2p)/2
    elif h1p+h2p < 360: hbp = (h1p+h2p+360)/2
    else: hbp = (h1p+h2p-360)/2
    T = (1 - 0.17*math.cos(math.radians(hbp-30)) + 0.24*math.cos(math.radians(2*hbp))
         + 0.32*math.cos(math.radians(3*hbp+6)) - 0.20*math.cos(math.radians(4*hbp-63)))
    dT = 30*math.exp(-(((hbp-275)/25)**2))
    Rc = 2*math.sqrt(Cbp**7/(Cbp**7+25**7)) if Cbp > 0 else 0
    Sl = 1 + (0.015*(Lbp-50)**2)/math.sqrt(20+(Lbp-50)**2)
    Sc, Sh = 1 + 0.045*Cbp, 1 + 0.015*Cbp*T
    Rt = -math.sin(math.radians(2*dT))*Rc
    return math.sqrt((dLp/Sl)**2 + (dCp/Sc)**2 + (dHp/Sh)**2 + Rt*(dCp/Sc)*(dHp/Sh))

# --- CVD simulation (Viénot/Brettel/Mollon 1999, LMS reduction) -------------
def _m(M, v): return tuple(sum(M[i][j]*v[j] for j in range(3)) for i in range(3))
RGB2LMS = ((17.8824,43.5161,4.11935),(3.45565,27.1554,3.86714),(0.0299566,0.184309,1.46709))
LMS2RGB = ((0.080944,-0.130504,0.116721),(-0.0102485,0.0540194,-0.113615),(-0.000365294,-0.00412163,0.693513))
DEUT = ((1,0,0),(0.494207,0,1.24827),(0,0,1))
PROT = ((0,2.02344,-2.52581),(0,1,0),(0,0,1))
def cvd(rgb, M):
    v = tuple(lin(c)*255 for c in rgb)
    out = _m(LMS2RGB, _m(M, _m(RGB2LMS, v)))
    def unlin(c):
        c = max(0.0, min(1.0, c/255))
        return 255*(12.92*c if c <= 0.0031308 else 1.055*c**(1/2.4) - 0.055)
    return tuple(unlin(c) for c in out)

