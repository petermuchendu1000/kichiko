import time
from engine_multi import fuzz
tot=0
for n in (2,3,4,6,8,12):
  for seed in range(5):
    for stp in (True,False):
      t0=time.time(); ev=fuzz(n, 40000, seed=1000*n+seed, check_every=100, stp=stp); dt=time.time()-t0
      tot+=40000
      cr=ev.crossed_report()
      if seed==0: print(f"n={n} stp={stp} S={ev.S} {ev.stats} crossed={cr} {dt:.1f}s")
      if not stp: assert sum(cr.values())==0, (n,seed,cr)
print("total ops fuzzed with exact invariants:", tot)
# volume with vs without cross-outcome matching
for n in (3,5,8):
  a=fuzz(n,40000,seed=7,check_every=500,cross=True,stp=False)
  b=fuzz(n,40000,seed=7,check_every=500,cross=False,stp=False)
  va=sum(1 for o in a.orders.values() if o.lots>o.rem)
  vb=sum(1 for o in b.orders.values() if o.lots>o.rem)
  fa=sum(o.lots-o.rem for o in a.orders.values() if o.live or o.rem==0)
  print(f"n={n} orders with >=1 fill: cross={va} nocross={vb}; residual crossed nocross={b.crossed_report()}")
