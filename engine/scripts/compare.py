#!/usr/bin/env python3
"""compare.py DIR SEED...: compare sql_<seed>.json with twin_<seed>.{btree,tick}.json.
Every field is compared as the exact text PostgreSQL produced (value and
scale), and additionally as Decimal (value) so a report can tell the two
apart. Prints per-seed and total counts; exit 1 on any divergence."""
import sys, json, re
from decimal import Decimal as D
from collections import Counter
NUM = re.compile(r"^-?\d+(\.\d+)?$")

def norm(v):
    if isinstance(v, str) and NUM.match(v): return D(v)
    if isinstance(v, list): return [norm(x) for x in v]
    if isinstance(v, dict): return {k: norm(x) for k, x in v.items()}
    return v

tot = Counter(); bad_total = 0
d = sys.argv[1]
for seed in sys.argv[2:]:
    S = json.load(open(f"{d}/sql_{seed}.json"))
    for book in ("btree", "tick"):
        T = json.load(open(f"{d}/twin_{seed}.{book}.json"))
        bad = 0; textdiff = 0
        for x, y in zip(S["results"], T["results"]):
            if norm(x) != norm(y):
                bad += 1
                if bad <= 5: print(f"[seed {seed} {book}] DIFF op {x['s']}\n   sql : {x}\n   twin: {y}")
            elif x != y: textdiff += 1
        if len(S["results"]) != len(T["results"]): bad += 1; print("length differs")
        od = [s for s in S["orders"] if norm(S["orders"][s]) != norm(T["orders"].get(s))]
        if len(S["orders"]) != len(T["orders"]): od.append("count")
        for s in od[:5]: print(f"[seed {seed} {book}] ORDER {s}: sql={S['orders'].get(s)} twin={T['orders'].get(s)}")
        ps = sorted(map(lambda p: json.dumps(norm(p), default=str), S["positions"]))
        pt = sorted(map(lambda p: json.dumps(norm(p), default=str), T["positions"]))
        pdiff = sorted(set(ps) ^ set(pt))
        for p in pdiff[:6]: print(f"[seed {seed} {book}] POSITION {'sql ' if p in ps else 'twin'} {p}")
        wdiff = [(a, b) for a, b in zip(S["wallets"], T["wallets"]) if norm(a) != norm(b)]
        for w in wdiff[:6]: print(f"[seed {seed} {book}] WALLET sql={w[0]} twin={w[1]}")
        wtext = sum(1 for a, b in zip(S["wallets"], T["wallets"]) if a != b)
        otext = sum(1 for s_ in S["orders"] if S["orders"][s_] != T["orders"].get(s_))
        ptext = len(set(map(json.dumps, S["positions"])) ^ set(map(json.dumps, T["positions"])))
        ok = bad == 0 and not od and not pdiff and not wdiff
        bad_total += (not ok)
        if book == "tick":
            R = S["results"]
            fills = [f for x in R for f in x.get("fills", [])]
            errs = Counter(x["err"] for x in R if "err" in x)
            kinds = Counter(f[3] for f in fills)
            st = Counter(x["status"] for x in R if "status" in x)
            ncancel = sum(1 for x in R if "released_shares" in x); nexp = sum(x.get("expired", 0) for x in R)
            tot.update({"ops": len(R), "fills": len(fills), "orders": len(S["orders"]), "positions": len(S["positions"]),
                        "wallets": len(S["wallets"]), "cancels_ok": ncancel, "expired": nexp})
            tot.update({f"kind:{k}": v for k, v in kinds.items()}); tot.update({f"err:{k}": v for k, v in errs.items()})
            tot.update({f"status:{k}": v for k, v in st.items()})
            tot.update({f"cov:{k}": v for k, v in T.get("coverage", {}).items()})
            print(f"seed {seed}: ops={len(R)} fills={len(fills)} {dict(kinds)} orders={len(S['orders'])} "
                  f"positions={len(S['positions'])} errors={dict(errs)} cancels={ncancel} expired={nexp}")
        print(f"seed {seed} [{book}]: ops identical {len(S['results'])-bad}/{len(S['results'])}, "
              f"orders identical {len(S['orders'])-len(od)}/{len(S['orders'])}, positions {'IDENTICAL' if not pdiff else 'DIFF'}, "
              f"wallets {'IDENTICAL' if not wdiff else 'DIFF'} (text-level diffs: ops {textdiff}, orders {otext}, positions {ptext}, wallets {wtext}) -> {'OK' if ok else 'DIVERGED'}")
print("TOTAL", dict(sorted(tot.items())))
print("ALL IDENTICAL" if bad_total == 0 else f"DIVERGED in {bad_total} (seed,book) pairs")
sys.exit(1 if bad_total else 0)
