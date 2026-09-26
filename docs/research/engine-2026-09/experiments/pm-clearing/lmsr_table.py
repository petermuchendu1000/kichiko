"""LMSR as integer synthetic book orders on a tick grid (binary and n-outcome).
Quotes are derived from float math, but every fill is an integer (ticks x lots)
ledger movement; rounding always favours the AMM, so the b*ln(n) loss bound holds."""
import math, random
T=1000; LOTS=100  # 1 share = 100 lots
def lmsr_cost(q,b): m=max(q); return m+b*math.log(sum(math.exp((x-m)/b) for x in q))
def price(q,b,i):
    m=max(q); z=sum(math.exp((x-m)/b) for x in q); return math.exp((q[i]-m)/b)/z
def ask_ladder(q,b,i,depth):
    """Synthetic asks for YES_i: level k sells the lots that move p_i from tick t to t+1,
    priced at the UPPER tick (buyer pays >= LMSR integral). Quantities floored to lots."""
    p=price(q,b,i); t=math.floor(p*T)   # current tick at/below price
    R=sum(math.exp(x/b) for k,x in enumerate(q) if k!=i)
    out=[]; qi=q[i]
    for k in range(1,depth+1):
        tt=t+k
        if tt>=T: break
        # q_i such that p_i = tt/T  (others fixed): q_i = b*ln(R*p/(1-p))
        target=b*math.log(R*(tt/T)/(1-tt/T))
        dq=math.floor((target-qi)*LOTS)   # lots, floored (AMM sells less)
        if dq>0: out.append((tt,dq)); qi+=dq/LOTS
    return out
def run(n,b,steps,rnd):
    q=[0.0]*n; cash=0   # AMM cash in ticks*lots units (integer)
    worst_eps=0.0
    for s in range(steps):
        i=rnd.randrange(n)
        if rnd.random()<0.5:   # trader buys YES_i from AMM, takes 1..3 levels
            lad=ask_ladder(q,b,i,rnd.randint(1,3))
            for tt,dq in lad:
                before=lmsr_cost(q,b); q[i]+=dq/LOTS; after=lmsr_cost(q,b)
                paid=tt*dq                       # integer
                exact=(after-before)*T*LOTS
                assert paid>=exact-1e-6*abs(exact), (paid,exact)
                worst_eps=max(worst_eps,(paid-exact)/dq)
                cash+=paid
        else:  # trader sells YES_i to AMM == AMM buys: symmetric bid ladder at LOWER tick
            p=price(q,b,i); t=math.ceil(p*T)
            R=sum(math.exp(x/b) for k,x in enumerate(q) if k!=i)
            for k in range(1,rnd.randint(1,3)+1):
                tt=t-k
                if tt<=0: break
                target=b*math.log(R*(tt/T)/(1-tt/T))
                dq=math.floor((q[i]-target)*LOTS)
                if dq<=0: continue
                before=lmsr_cost(q,b); q[i]-=dq/LOTS; after=lmsr_cost(q,b)
                paid=tt*dq; exact=(before-after)*T*LOTS
                assert paid<=exact+1e-6*abs(exact)
                worst_eps=max(worst_eps,(exact-paid)/dq)
                cash-=paid
    # AMM liability at resolution: pays T*LOTS per share of the winner it is short
    loss=max(q[i]*T*LOTS for i in range(n))-cash    # worst outcome
    return loss/(T*LOTS), worst_eps
rnd=random.Random(3)
for n,b in ((2,100.0),(5,100.0),(10,50.0)):
    worst=0; we=0
    for r in range(300):
        l,e=run(n,b,300,rnd); worst=max(worst,l); we=max(we,e)
    print(f"n={n} b={b}: worst AMM loss {worst:.2f} vs bound b*ln(n)={b*math.log(n):.2f}; max per-lot spread over LMSR integral {we:.2f} ticks (<=1 tick)")
# adversarial: informed trader buys the winner (outcome 0) up to the last tick
for n,b in ((2,100.0),(5,100.0),(10,50.0)):
    q=[0.0]*n; cash=0
    while True:
        lad=ask_ladder(q,b,0,50)
        if not lad: break
        for tt,dq in lad: q[0]+=dq/LOTS; cash+=tt*dq
    loss=(q[0]*T*LOTS-cash)/(T*LOTS)
    print(f"adversarial n={n} b={b}: AMM loss {loss:.2f} vs b*ln(n)={b*math.log(n):.2f} (final p0={price(q,b,0):.4f})")
