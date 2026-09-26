import random, numpy as np
from batch import *
rnd=random.Random(5); T=1000
# tie interval widths and distance from reference
stats={r:[] for r in ("euronext","sse","szse")}; widths=[]
for trial in range(3000):
    K=rnd.choice([4,8,16,64]); fair=rnd.uniform(0.1,0.9)
    orders=gen_binary(K,T,rnd,fair=fair)
    ref=int(round(fair*T))+rnd.randint(-20,20)  # reference near fair value
    ref=max(1,min(T-1,ref))
    # interval of candidate prices
    res={r:uncross_binary(orders,T,ref,r) for r in stats}
    if res["euronext"][0] is None: continue
    for r in stats: stats[r].append(abs(res[r][0]-ref))
print("median/p90 |uncross price - reference| in ticks (T=1000), thin books K in {4,8,16,64}:")
for r,v in stats.items(): print(r, int(np.median(v)), int(np.percentile(v,90)), len(v))
# dual integrality
bad=0; tot=0
for n in (2,3,5,10):
  for K in (100,1000):
    for s in range(3):
      o=gen_event(n,K,T,rnd); lp=clear_event_lp(o,n,T); d=lp['duals']; tot+=1
      if not np.all(np.abs(d-np.round(d))<1e-6): bad+=1
print("LP dual vectors non-integral:",bad,"of",tot)
