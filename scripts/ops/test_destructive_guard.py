#!/usr/bin/env python3
"""test_destructive_guard.py - audit 6.36: data-rewriting scripts refuse production."""
import os, sys, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from destructive_guard import check, project_ref, FLAG

fails = []
def expect(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}{(' - ' + detail) if detail else ''}")
    if not cond: fails.append(name)

REF = "abcdefghijklmnopqrst"
POOLER = f"postgresql://postgres.{REF}:pw@aws-0-eu-west-1.pooler.supabase.com:5432/postgres"
DIRECT = f"postgresql://postgres:pw@db.{REF}.supabase.co:5432/postgres"
LOCAL = "postgresql://postgres:pw@localhost:54322/postgres"

expect("project ref from a pooler URL", project_ref(POOLER) == REF)
expect("project ref from a direct URL", project_ref(DIRECT) == REF)
expect("writing needs the flag", check(LOCAL, ["x"], {}) is not None)
expect("local with the flag is allowed", check(LOCAL, ["x", FLAG], {}) is None)
expect("--dry-run needs no flag", check(LOCAL, ["x", "--dry-run"], {}) is None)
expect("a Supabase project not on the allowlist is refused, even with the flag", check(POOLER, ["x", FLAG], {}) is not None)
expect("... and even for a dry run", check(DIRECT, ["x", "--dry-run"], {}) is not None)
expect("listed in NONPROD_PROJECT_REFS -> allowed", check(POOLER, ["x", FLAG], {"NONPROD_PROJECT_REFS": f"zzz,{REF}"}) is None)
expect("an unknown remote host is refused", check("postgresql://u:p@db.example.com/x", ["x", FLAG], {"NONPROD_PROJECT_REFS": REF}) is not None)

here = os.path.dirname(os.path.abspath(__file__))
# (script, extra args: a writing subcommand where the script has subcommands)
scripts = [(os.path.join(here, "reconcile_ledger.py"), []), (os.path.join(here, "..", "sim", "rebase_to_kes_peg.py"), []),
           (os.path.join(here, "..", "sim", "reseed_amm_to_clob.py"), ["remove"]),
           (os.path.join(here, "..", "sim", "seed_intensive.py"), ["price"])]
checks = 9
for sc, extra in scripts:
    name = os.path.basename(sc)
    env = {k: v for k, v in os.environ.items() if k not in ("SEED_DB_URL", "NONPROD_PROJECT_REFS")}
    probe = subprocess.run([sys.executable, sc, "--help"], env=env, capture_output=True, text=True, timeout=60)
    if "ModuleNotFoundError" in probe.stderr:
        print(f"  [SKIP] {name}: its own dependencies are not installed ({probe.stderr.strip().splitlines()[-1]})")
        continue
    checks += 2
    r = subprocess.run([sys.executable, sc, FLAG, *extra], env={**env, "DATABASE_URL": POOLER}, capture_output=True, text=True, timeout=60)
    expect(f"{name}: DATABASE_URL alone is not used", r.returncode != 0 and "SEED_DB_URL" in (r.stderr + r.stdout), (r.stderr or r.stdout).strip()[-120:])
    r = subprocess.run([sys.executable, sc, FLAG, *extra], env={**env, "SEED_DB_URL": POOLER}, capture_output=True, text=True, timeout=60)
    expect(f"{name}: a production-shaped target is refused before connecting", r.returncode != 0 and "refusing" in (r.stderr + r.stdout), (r.stderr or r.stdout).strip()[-120:])

print(f"\nRESULT: {checks - len(fails)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
