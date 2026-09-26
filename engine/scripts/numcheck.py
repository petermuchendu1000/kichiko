#!/usr/bin/env python3
"""numcheck.py <cases.tsv>: evaluate every case on PostgreSQL (kdb2) and compare
the ::text result (value and display scale) with the twin's answer."""
import sys, psycopg2
URL = "postgresql://postgres:localtest@localhost:54323/postgres"
rows = [l.rstrip("\n").split("\t") for l in open(sys.argv[1])]
c = psycopg2.connect(URL); k = c.cursor()
bad = 0; by = {}
for i in range(0, len(rows), 400):
    chunk = rows[i:i+400]
    for (cid, expr, twin) in chunk:
        k.execute("savepoint s")
        try:
            k.execute(f"select ({expr})::text"); got = k.fetchone()[0]
        except psycopg2.Error as e:
            k.execute("rollback to savepoint s")
            got = "OVERFLOW" if e.pgcode == "22003" else "ERR:" + e.pgcode
        kind = expr.split("(")[0][:12]
        by[kind] = by.get(kind, 0) + 1
        if got != twin:
            bad += 1
            if bad <= 10: print("MISMATCH", cid, expr, "pg=", got, "twin=", twin)
print(f"cases={len(rows)} mismatches={bad}")
sys.exit(1 if bad else 0)
