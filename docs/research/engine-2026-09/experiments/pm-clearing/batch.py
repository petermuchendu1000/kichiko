"""
Batch (call) auction clearing for Kichiko, exact integers.

1. uncross_binary(): single unified YES/NO ladder, uniform price, tie-break
   chains of Euronext/LSE (max volume, min imbalance, market pressure,
   reference price), SSE (max volume, min imbalance, midpoint) and SZSE
   (max volume, min imbalance, closest to reference).  O(K + L).
2. clear_event_lp(): joint clearing of a mutually exclusive n-outcome event
   as an LP (HiGHS).  Duals = clearing prices, sum to T.
3. clear_event_comb(): combinatorial algorithm: maximise sum_j W_j(m) - T*m
   over the integer number m of complete sets minted (m<0: merged); W_j is
   concave so integer ternary search works. O(n * L * log Q).
"""
import random, time, math
import numpy as np

# ---------------------------------------------------------------- binary uncross
def uncross_binary(orders, T, ref, rule="euronext"):
    """orders: list of dicts {id, ybid(bool), py(int YES price), lots, seq}.
    Returns (price, volume, fills{id: lots})."""
    L = T
    bidq = [0] * (L + 1)
    askq = [0] * (L + 1)
    for o in orders:
        (bidq if o["ybid"] else askq)[o["py"]] += o["lots"]
    D = [0] * (L + 2)          # bids with price >= p
    for p in range(L - 1, 0, -1):
        D[p] = D[p + 1] + bidq[p]
    S = [0] * (L + 1)          # asks with price <= p
    for p in range(1, L):
        S[p] = S[p - 1] + askq[p]
    best_v = 0
    cands = []
    for p in range(1, L):
        v = min(D[p], S[p])
        if v > best_v:
            best_v, cands = v, [p]
        elif v == best_v and v > 0:
            cands.append(p)
    if best_v == 0:
        return None, 0, {}
    imb = {p: D[p] - S[p] for p in cands}
    mi = min(abs(x) for x in imb.values())
    cands = [p for p in cands if abs(imb[p]) == mi]
    if len(cands) > 1:
        if rule == "sse":
            lo, hi = min(cands), max(cands)
            price = (lo + hi) // 2 if (lo + hi) % 2 == 0 else ((lo + hi) // 2 if abs(ref - (lo + hi) // 2) <= abs(ref - (lo + hi + 1) // 2) else (lo + hi + 1) // 2)
        elif rule == "szse":
            price = min(cands, key=lambda p: (abs(p - ref), p))
        else:  # euronext / LSE: market pressure then reference price
            if all(imb[p] > 0 for p in cands):
                price = max(cands)
            elif all(imb[p] < 0 for p in cands):
                price = min(cands)
            else:
                lo, hi = min(cands), max(cands)
                price = ref if lo <= ref <= hi else (hi if ref > hi else lo)
                if price not in cands:  # ref inside range but between candidate levels
                    price = min(cands, key=lambda p: (abs(p - ref), p))
    else:
        price = cands[0]
    V = min(D[price], S[price])
    # allocation: strictly better prices fill fully, at-price by time priority
    fills = {}
    bids = sorted([o for o in orders if o["ybid"] and o["py"] >= price], key=lambda o: (-o["py"], o["seq"]))
    asks = sorted([o for o in orders if (not o["ybid"]) and o["py"] <= price], key=lambda o: (o["py"], o["seq"]))
    for book in (bids, asks):
        left = V
        for o in book:
            q = min(left, o["lots"])
            if q:
                fills[o["id"]] = q
            left -= q
        assert left == 0
    return price, V, fills


def check_binary_conservation(orders, price, fills, T):
    """Binary market: YES buyers pay p, NO buyers pay T-p, sellers receive the same.
    Net cash into the pool must equal T * (change in outstanding sets)."""
    yb = ys = nb = ns = 0
    cash = 0
    for o in orders:
        q = fills.get(o["id"], 0)
        if not q:
            continue
        own = price if o["tok"] == 'Y' else T - price
        if o["side"] == 'B':
            cash += own * q
            assert own <= o["p"]
        else:
            cash -= own * q
            assert own >= o["p"]
        if o["tok"] == 'Y':
            if o["side"] == 'B': yb += q
            else: ys += q
        else:
            if o["side"] == 'B': nb += q
            else: ns += q
    dS = yb - ys
    assert dS == nb - ns, "YES and NO supply must move together"
    assert cash == T * dS, (cash, T * dS)
    return dS


def brute_uncross_volume(orders, T):
    best = 0
    for p in range(1, T):
        d = sum(o["lots"] for o in orders if o["ybid"] and o["py"] >= p)
        s = sum(o["lots"] for o in orders if (not o["ybid"]) and o["py"] <= p)
        best = max(best, min(d, s))
    return best


def gen_binary(K, T, rnd, fair=None):
    fair = fair if fair is not None else rnd.uniform(0.1, 0.9)
    orders = []
    for i in range(K):
        tok = 'Y' if rnd.random() < 0.5 else 'N'
        side = 'B' if rnd.random() < 0.5 else 'S'
        f = fair if tok == 'Y' else 1 - fair
        p = max(1, min(T - 1, int(round((f + rnd.gauss(0, 0.05)) * T))))
        ybid = (tok == 'Y') == (side == 'B')
        py = p if tok == 'Y' else T - p
        orders.append(dict(id=i, tok=tok, side=side, p=p, py=py, ybid=ybid,
                           lots=rnd.choice([1, 5, 10, 100, 1000]), seq=i))
    return orders


# ---------------------------------------------------------------- multi-outcome
def gen_event(n, K, T, rnd):
    w = [rnd.random() + 0.1 for _ in range(n)]
    s = sum(w)
    prob = [x / s for x in w]
    orders = []
    for i in range(K):
        j = rnd.randrange(n)
        tok = 'Y' if rnd.random() < 0.6 else 'N'
        side = 'B' if rnd.random() < 0.6 else 'S'
        f = prob[j] if tok == 'Y' else 1 - prob[j]
        p = max(1, min(T - 1, int(round((f + rnd.gauss(0, 0.05)) * T))))
        ybid = (tok == 'Y') == (side == 'B')
        py = p if tok == 'Y' else T - p
        orders.append(dict(id=i, j=j, tok=tok, side=side, p=p, py=py, ybid=ybid,
                           lots=rnd.choice([1, 5, 10, 100, 1000]), seq=i))
    return orders


def clear_event_lp(orders, n, T, integral=False):
    """maximise sum_buy p x - sum_sell p x - T m
       s.t. for each outcome j: sum_k A_kj x_k - m = 0,  0<=x_k<=Q_k.
    A_k = +e_j (Y buy), -e_j (Y sell), 1-e_j (N buy), -(1-e_j) (N sell)."""
    from scipy.optimize import linprog
    from scipy.sparse import lil_matrix
    K = len(orders)
    c = np.zeros(K + 1)
    A = lil_matrix((n, K + 1))
    ub = np.zeros(K + 1)
    for k, o in enumerate(orders):
        sgn = 1 if o["side"] == 'B' else -1
        c[k] = -sgn * o["p"]           # linprog minimises
        ub[k] = o["lots"]
        if o["tok"] == 'Y':
            A[o["j"], k] = sgn
        else:
            for jj in range(n):
                if jj != o["j"]:
                    A[jj, k] = sgn
    c[K] = T
    A[:, K] = -1
    bounds = [(0, ub[k]) for k in range(K)] + [(None, None)]
    t0 = time.perf_counter()
    res = linprog(c, A_eq=A.tocsr(), b_eq=np.zeros(n), bounds=bounds, method="highs",
                  integrality=(np.ones(K + 1) if integral else None))
    dt = time.perf_counter() - t0
    assert res.status == 0, res.message
    x = res.x
    welfare = -res.fun
    duals = None if integral else -res.eqlin.marginals
    return dict(x=x, welfare=welfare, duals=duals, time=dt)


def clear_event_comb(orders, n, T):
    """Exact integer combinatorial clearing via concave search over m."""
    # per outcome YES-perspective levels
    bids = [[0] * (T + 1) for _ in range(n)]
    asks = [[0] * (T + 1) for _ in range(n)]
    const = 0  # value-neutral set adjustment from NO legs: see note
    for o in orders:
        (bids if o["ybid"] else asks)[o["j"]][o["py"]] += o["lots"]
    # Using YES-perspective prices: a NO buy at p == YES ask at T-p (plus one set,
    # worth exactly T, which cancels in welfare), so welfare is identical.
    blv = [[(p, bids[j][p]) for p in range(T - 1, 0, -1) if bids[j][p]] for j in range(n)]
    alv = [[(p, asks[j][p]) for p in range(1, T) if asks[j][p]] for j in range(n)]

    def W(j, m):
        """max sum bids filled*price - sum asks filled*price, net filled = m."""
        B, A = blv[j], alv[j]
        # take m extra bids (m>0) or -m extra asks (m<0) first, then pair while bid>ask
        bi = ai = 0; brem = B[0][1] if B else 0; arem = A[0][1] if A else 0
        val = 0
        need = m
        # consume 'need' from bids (if positive) or asks (if negative)
        while need > 0:
            if bi >= len(B): return None
            q = min(need, brem); val += q * B[bi][0]; need -= q; brem -= q
            if brem == 0:
                bi += 1; brem = B[bi][1] if bi < len(B) else 0
        while need < 0:
            if ai >= len(A): return None
            q = min(-need, arem); val -= q * A[ai][0]; need += q; arem -= q
            if arem == 0:
                ai += 1; arem = A[ai][1] if ai < len(A) else 0
        # then pair best remaining bid with best remaining ask while profitable
        while bi < len(B) and ai < len(A) and B[bi][0] > A[ai][0]:
            q = min(brem, arem); val += q * (B[bi][0] - A[ai][0]); brem -= q; arem -= q
            if brem == 0:
                bi += 1; brem = B[bi][1] if bi < len(B) else 0
            if arem == 0:
                ai += 1; arem = A[ai][1] if ai < len(A) else 0
        return val

    def F(m):
        tot = -T * m
        for j in range(n):
            w = W(j, m)
            if w is None:
                return None
            tot += w
        return tot

    lo = -min(sum(q for _, q in alv[j]) for j in range(n))
    hi = min(sum(q for _, q in blv[j]) for j in range(n))
    # integer ternary search on concave F over [lo, hi]
    while hi - lo > 2:
        m1 = lo + (hi - lo) // 3
        m2 = hi - (hi - lo) // 3
        if F(m1) < F(m2):
            lo = m1 + 1
        else:
            hi = m2
    best_m = max(range(lo, hi + 1), key=lambda m: F(m))
    return dict(m=best_m, welfare=F(best_m))


def continuous_welfare(orders, n, T, seed=0):
    """Feed the same orders one by one into the continuous engine (random arrival
    order) and compute realised gains from trade at limit prices."""
    from engine_multi import Event
    ev = Event(n, T, cross=True, stp=False)
    ev.deposit(0, 10**15)
    # give the single account enough holdings to sell: pre-mint complete sets
    # (value-neutral: welfare is measured relative to limits)
    big = sum(o["lots"] for o in orders)
    acct = ev.accts[0]
    acct.cash -= big * T
    for k in range(n):
        acct.h[k] += big
    ev.S += big; ev.collateral += big * T
    S0 = ev.S
    order_ids = []
    for o in orders:
        oid = ev.place(0, o["j"], o["tok"], o["side"], o["p"], o["lots"])
        order_ids.append((oid, o))
    welfare = 0
    for oid, o in order_ids:
        eo = ev.orders[oid]
        filled = eo.lots - eo.rem
        welfare += (1 if o["side"] == 'B' else -1) * o["p"] * filled
    welfare -= T * (ev.S - S0)
    return welfare


if __name__ == "__main__":
    rnd = random.Random(1)
    T = 1000
    # ---- 1. binary uncross: correctness vs brute force, conservation, timing
    ok = 0
    for trial in range(300):
        orders = gen_binary(rnd.choice([5, 20, 60]), T, rnd)
        ref = rnd.randrange(1, T)
        for rule in ("euronext", "sse", "szse"):
            price, V, fills = uncross_binary(orders, T, ref, rule)
            bv = brute_uncross_volume(orders, T)
            assert V == bv, (V, bv)
            if price is not None:
                check_binary_conservation(orders, price, fills, T)
        ok += 1
    print("binary uncross: 300 random books x 3 rule sets: volume == brute force, cash conservation exact")
    for K in (1000, 10000, 100000):
        orders = gen_binary(K, T, rnd)
        t0 = time.perf_counter(); uncross_binary(orders, T, 500); dt = time.perf_counter() - t0
        print(f"binary uncross K={K} L={T-1}: {dt*1000:.1f} ms (CPython, 1 core)")
    # rule divergence: how often do the tie-break chains pick different prices?
    diff = 0; tot = 0
    for trial in range(2000):
        orders = gen_binary(rnd.choice([4, 8, 16]), T, rnd)
        ref = rnd.randrange(1, T)
        ps = {r: uncross_binary(orders, T, ref, r)[0] for r in ("euronext", "sse", "szse")}
        if ps["euronext"] is None: continue
        tot += 1
        if len(set(ps.values())) > 1: diff += 1
    print(f"tie-break rule sets disagree on price in {diff}/{tot} thin random books")

    # ---- 2/3. multi-outcome joint clearing
    print("n, K, LP ms, MILP ms, comb ms, LP welfare, comb welfare, sum(duals), LP x integral?, continuous welfare / batch")
    for n in (2, 3, 5, 10, 20):
        for K in (100, 1000, 10000):
            orders = gen_event(n, K, T, rnd)
            lp = clear_event_lp(orders, n, T)
            integral = bool(np.all(np.abs(lp["x"] - np.round(lp["x"])) < 1e-6))
            mi_t = float('nan')
            if K <= 1000:
                mi = clear_event_lp(orders, n, T, integral=True)
                mi_t = mi["time"] * 1000
                assert abs(mi["welfare"] - lp["welfare"]) < 1e-6 * max(1, abs(lp["welfare"])), (mi["welfare"], lp["welfare"])
            t0 = time.perf_counter(); cb = clear_event_comb(orders, n, T); ct = (time.perf_counter() - t0) * 1000
            cw = continuous_welfare(orders, n, T) if K <= 10000 else float('nan')
            print(f"{n}, {K}, {lp['time']*1000:.1f}, {mi_t:.1f}, {ct:.1f}, {lp['welfare']:.0f}, {cb['welfare']}, {lp['duals'].sum():.3f}, {integral}, {cw/lp['welfare']:.4f}")
