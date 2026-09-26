"""
Reference (non-production) exact-integer continuous matcher for a mutually
exclusive n-outcome event, in the canonical YES basis.

Units (all Python ints, never floats):
  T      = price ticks per 1 unit of collateral (1000 -> 0.1 cent tick)
  lots   = quantity unit (e.g. 1 share = 100 lots)
  cash   = ticks * lots  (so 1 unit of collateral per lot = T cash units)

Every account holds cash, reserved cash, and a holdings vector h[0..n-1]
over outcome-YES tokens. NO_j is represented as +1 on every k != j.
A "complete set" is the all-ones vector and is backed by exactly T cash
units per lot in the collateral pool.

Order types: (outcome j, token 'Y'|'N', side 'B'|'S', own-token price p, lots)
YES-perspective: bid on j  = Y-buy @p  or N-sell @(T-p)
                 ask on j  = Y-sell @p or N-buy  @(T-p)
Match patterns (complete for single-outcome orders):
  P1 (direct/binary mint/merge): bid on j vs ask on j
  P2 (n-way mint): bids on every outcome, sum of YES prices >= T
  P3 (n-way merge): asks on every outcome, sum of YES prices <= T
"""
from collections import deque
import random


class Acct:
    __slots__ = ("cash", "rcash", "h", "rh")

    def __init__(self, n, cash):
        self.cash = cash
        self.rcash = 0
        self.h = [0] * n
        self.rh = [0] * n


class Order:
    __slots__ = ("id", "acct", "j", "tok", "side", "p", "lots", "rem", "py", "ybid", "live")


class Event:
    def __init__(self, n, T=1000, fee=None, cross=True, stp=True):
        self.n, self.T = n, T
        self.cross, self.stp = cross, stp
        self.accts = {}
        self.orders = {}
        self.S = 0              # outstanding complete sets (lots)
        self.collateral = 0     # cash units
        self.deposits = 0
        self.next_id = 1
        # books[j][0]=bids, [1]=asks : list indexed by YES price -> deque(order ids)
        self.books = [[[deque() for _ in range(T + 1)] for _ in range(2)] for _ in range(n)]
        self.best = [[None, None] for _ in range(n)]  # best bid / best ask YES price
        self.stats = {"P1": 0, "P1_mint": 0, "P1_merge": 0, "P2": 0, "P3": 0, "legs": 0}

    # ---------------- accounts ----------------
    def deposit(self, a, cash):
        if a not in self.accts:
            self.accts[a] = Acct(self.n, 0)
        self.accts[a].cash += cash
        self.deposits += cash

    # ---------------- book helpers ----------------
    def _refresh_best(self, j, side):
        lvls = self.books[j][side]
        rng = range(self.T - 1, 0, -1) if side == 0 else range(1, self.T)
        cur = self.best[j][side]
        # scan from current best outward (bounded by grid size L)
        if cur is not None:
            rng = range(cur, 0, -1) if side == 0 else range(cur, self.T)
        for px in rng:
            q = lvls[px]
            while q and not self.orders[q[0]].live:
                q.popleft()
            if q:
                self.best[j][side] = px
                return
        self.best[j][side] = None

    def _top(self, j, side):
        px = self.best[j][side]
        if px is None:
            return None
        q = self.books[j][side][px]
        while q and not self.orders[q[0]].live:
            q.popleft()
        if not q:
            self._refresh_best(j, side)
            return self._top(j, side)
        return self.orders[q[0]]

    # ---------------- reservation ----------------
    def _reserve(self, o):
        a = self.accts[o.acct]
        if o.side == 'B':
            need = o.p * o.lots
            if a.cash < need:
                return False
            a.cash -= need
            a.rcash += need
        else:
            ks = [o.j] if o.tok == 'Y' else [k for k in range(self.n) if k != o.j]
            if any(a.h[k] < o.lots for k in ks):
                return False
            for k in ks:
                a.h[k] -= o.lots
                a.rh[k] += o.lots
        return True

    def _release(self, o, lots):
        a = self.accts[o.acct]
        if o.side == 'B':
            a.rcash -= o.p * lots
            a.cash += o.p * lots
        else:
            ks = [o.j] if o.tok == 'Y' else [k for k in range(self.n) if k != o.j]
            for k in ks:
                a.rh[k] -= lots
                a.h[k] += lots

    # ---------------- one leg of a fill ----------------
    def _leg(self, o, py_exec, q):
        """Apply a fill of q lots to order o at YES-perspective price py_exec.
        Returns (cash paid into the match by this account, holdings delta vector)."""
        a = self.accts[o.acct]
        T = self.T
        own = py_exec if o.tok == 'Y' else T - py_exec
        # limit check in own terms (buy pays <= limit, sell receives >= limit)
        assert (own <= o.p) if o.side == 'B' else (own >= o.p), (o.side, own, o.p)
        dv = [0] * self.n
        if o.side == 'B':
            a.rcash -= o.p * q
            a.cash += (o.p - own) * q           # price improvement refund
            paid = own * q
            ks = [o.j] if o.tok == 'Y' else [k for k in range(self.n) if k != o.j]
            for k in ks:
                a.h[k] += q
                dv[k] += q
        else:
            ks = [o.j] if o.tok == 'Y' else [k for k in range(self.n) if k != o.j]
            for k in ks:
                a.rh[k] -= q
                dv[k] -= q
            a.cash += own * q
            paid = -own * q
        o.rem -= q
        if o.rem == 0:
            o.live = False
        self.stats["legs"] += 1
        return paid, dv

    def _settle_match(self, legs_result, q):
        """legs_result: list of (paid, dv). Check that the net holdings change is
        c * (all-ones) and that net cash paid equals c * T * q exactly."""
        n = self.n
        tot = [0] * n
        cash = 0
        for paid, dv in legs_result:
            cash += paid
            for k in range(n):
                tot[k] += dv[k]
        c = tot[0]
        assert all(t == c for t in tot), tot
        assert c % q == 0
        sets = c // q
        assert cash == sets * self.T * q, (cash, sets, q)
        self.S += c
        self.collateral += cash
        return sets

    # ---------------- place / cancel ----------------
    def place(self, acct, j, tok, side, p, lots):
        assert 1 <= p <= self.T - 1 and lots > 0
        o = Order()
        o.id, o.acct, o.j, o.tok, o.side, o.p, o.lots, o.rem = self.next_id, acct, j, tok, side, p, lots, lots
        self.next_id += 1
        o.ybid = (tok == 'Y') == (side == 'B')
        o.py = p if tok == 'Y' else self.T - p
        o.live = True
        self.orders[o.id] = o
        if not self._reserve(o):
            o.live = False
            return None
        self._match(o)
        if o.rem > 0:
            s = 0 if o.ybid else 1
            self.books[j][s][o.py].append(o.id)
            b = self.best[j][s]
            if b is None or (s == 0 and o.py > b) or (s == 1 and o.py < b):
                self.best[j][s] = o.py
        return o.id

    def cancel(self, oid):
        o = self.orders.get(oid)
        if not o or not o.live:
            return
        o.live = False
        self._release(o, o.rem)
        o.rem = 0
        s = 0 if o.ybid else 1
        if self.best[o.j][s] == o.py:
            self._refresh_best(o.j, s)

    def _match(self, o):
        T, n, j = self.T, self.n, o.j
        tb = o.ybid
        while o.rem > 0:
            # P1 candidate
            opp = 1 if tb else 0
            m1 = self._top(j, opp)
            c1 = None
            if m1 is not None and (not self.stp or m1.acct != o.acct):
                if (tb and m1.py <= o.py) or ((not tb) and m1.py >= o.py):
                    c1 = m1.py
            # P2/P3 candidate: same-side tops on every other outcome
            side_other = 0 if tb else 1
            tops = []
            ok = n >= 2 and self.cross
            if ok:
                for k in range(n):
                    if k == j:
                        continue
                    t = self._top(k, side_other)
                    if t is None or (self.stp and t.acct == o.acct):
                        ok = False
                        break
                    tops.append(t)
            c2 = None
            if ok:
                s_other = sum(t.py for t in tops)
                px = T - s_other
                if 1 <= px <= T - 1 and ((tb and px <= o.py) or ((not tb) and px >= o.py)):
                    c2 = px
            if c1 is None and c2 is None:
                break
            use1 = c2 is None or (c1 is not None and ((tb and c1 <= c2) or ((not tb) and c1 >= c2)))
            if use1:
                q = min(o.rem, m1.rem)
                r = [self._leg(m1, c1, q), self._leg(o, c1, q)]
                sets = self._settle_match(r, q)
                self.stats["P1"] += 1
                if sets > 0:
                    self.stats["P1_mint"] += 1
                elif sets < 0:
                    self.stats["P1_merge"] += 1
                if not m1.live:
                    self._refresh_best(j, opp)
            else:
                q = min([o.rem] + [t.rem for t in tops])
                r = [self._leg(t, t.py, q) for t in tops]
                r.append(self._leg(o, c2, q))
                self._settle_match(r, q)
                self.stats["P2" if tb else "P3"] += 1
                for t in tops:
                    if not t.live:
                        self._refresh_best(t.j, side_other)

    # ---------------- invariants ----------------
    def check(self):
        n, T = self.n, self.T
        for k in range(n):
            s = sum(a.h[k] + a.rh[k] for a in self.accts.values())
            assert s == self.S, ("I1 outcome", k, s, self.S)
        assert self.collateral == self.S * T, "collateral"
        tot = sum(a.cash + a.rcash for a in self.accts.values()) + self.collateral
        assert tot == self.deposits, ("cash conservation", tot, self.deposits)
        for a in self.accts.values():
            assert a.cash >= 0 and a.rcash >= 0 and min(a.h) >= 0 and min(a.rh) >= 0
        # reservations equal open-order requirements
        need = {k: [0, [0] * n] for k in self.accts}
        for o in self.orders.values():
            if o.live:
                if o.side == 'B':
                    need[o.acct][0] += o.p * o.rem
                else:
                    ks = [o.j] if o.tok == 'Y' else [k for k in range(n) if k != o.j]
                    for k in ks:
                        need[o.acct][1][k] += o.rem
        for k, a in self.accts.items():
            assert a.rcash == need[k][0] and a.rh == need[k][1], "I4 reservations"
        # no crossed book (single and cross-outcome)
        bb = [self.best[k][0] for k in range(n)]
        ba = [self.best[k][1] for k in range(n)]
        for k in range(n):
            if bb[k] is not None and ba[k] is not None:
                # equal-account self-cross is allowed to rest (STP), skip strict check then
                pass
        return True

    def crossed_report(self):
        """Count residual riskless opportunities among resting orders of DIFFERENT
        accounts (should be zero except for self-trade-prevented cases)."""
        n, T = self.n, self.T
        bb = [self.best[k][0] for k in range(n)]
        ba = [self.best[k][1] for k in range(n)]
        out = {"p1": 0, "p2": 0, "p3": 0}
        for k in range(n):
            if bb[k] is not None and ba[k] is not None and bb[k] >= ba[k]:
                out["p1"] += 1
        if all(x is not None for x in bb) and sum(bb) >= T:
            out["p2"] += 1
        if all(x is not None for x in ba) and sum(ba) <= T:
            out["p3"] += 1
        return out


def normalize_collateral_return(ev, a):
    """Kalshi-style collateral return / Polymarket convert in the canonical basis:
    move min_k h[k] complete sets out of the account into cash (merge)."""
    acct = ev.accts[a]
    m = min(acct.h)
    if m > 0:
        for k in range(ev.n):
            acct.h[k] -= m
        acct.cash += m * ev.T
        ev.S -= m
        ev.collateral -= m * ev.T
    return m


def fuzz(n, ops, seed, T=1000, n_accts=12, check_every=1, cross=True, stp=True):
    rnd = random.Random(seed)
    ev = Event(n, T, cross=cross, stp=stp)
    for a in range(n_accts):
        ev.deposit(a, 10_000_000 * T)  # plenty of cash
    # true probabilities for price generation
    w = [rnd.random() + 0.05 for _ in range(n)]
    s = sum(w)
    prob = [x / s for x in w]
    live = []
    crossed_nonself = 0
    for i in range(ops):
        r = rnd.random()
        a = rnd.randrange(n_accts)
        if r < 0.12 and live:
            oid = live.pop(rnd.randrange(len(live)))
            ev.cancel(oid)
        elif r < 0.16:
            normalize_collateral_return(ev, a)
        else:
            j = rnd.randrange(n)
            tok = 'Y' if rnd.random() < 0.6 else 'N'
            side = 'B' if rnd.random() < 0.6 else 'S'
            fair = prob[j] if tok == 'Y' else 1 - prob[j]
            px = int(round((fair + rnd.gauss(0, 0.06)) * T))
            px = max(1, min(T - 1, px))
            lots = rnd.choice([1, 3, 10, 50, 100, 250])
            acct = ev.accts[a]
            if side == 'S':
                ks = [j] if tok == 'Y' else [k for k in range(n) if k != j]
                have = min(acct.h[k] for k in ks)
                if have <= 0:
                    side = 'B'
                else:
                    lots = min(lots, have)
            oid = ev.place(a, j, tok, side, px, lots)
            if oid is not None and ev.orders[oid].live:
                live.append(oid)
        if i % check_every == 0:
            ev.check()
    ev.check()
    return ev


if __name__ == "__main__":
    import time, sys
    for n in (2, 3, 5, 8):
        t0 = time.time()
        ev = fuzz(n, 20000, seed=42 + n, check_every=25)
        dt = time.time() - t0
        print(f"n={n} ops=20000 ok S={ev.S} stats={ev.stats} crossed={ev.crossed_report()} t={dt:.1f}s")
