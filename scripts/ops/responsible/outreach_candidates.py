#!/usr/bin/env python3
"""
scripts/ops/responsible/outreach_candidates.py — who to ring this week.

Ruling I4 of docs/research/ui-2026-09/40-ELEMENT-MATRIX.md. Of everything in
the responsible-gambling literature reviewed in [31], the single intervention
with the best evidence-to-cost ratio is not a pop-up, a leaflet or a nudge:
it is a person telephoning the heaviest losers. Jonsson et al. (2020), a
randomised trial on Svenska Spel, found a ~30% reduction in losses at twelve
months for the contacted group, d = 0.44 — an effect size nothing on a screen
in that review comes close to. Deposit prompts, by contrast, measured null on
losses (Ivanova et al.).

This script does the part a machine should do: say WHO. The call itself is a
human job, and deliberately so — the trial's effect came from a conversation,
not from an automated message, and an SMS saying "we noticed you are losing a
lot" would be worse than silence.

WHAT IT RANKS BY

Net money out in the window — buys less sells less settlement payouts, the
same figure the loss limit enforces (migration 110). That is realised loss
plus the cost of positions still open, i.e. the worst case: the most this
person can be down from the period's trading. It binds now rather than at
settlement, which for markets that resolve months out is the difference
between a list and a post-mortem.

WHO IT LEAVES OUT

Anyone already on a break or self-excluded (migration 109). They have
stopped. A call about their losses would, at best, be redundant.

PRIVACY

Identifiers only, by default: the user id and the figures. Contact details
are PII and are not printed unless --with-contact is passed, which is for the
person actually making the calls, on a screen nobody else is reading. Kenya's
Data Protection Act 2019 makes the purpose limit the point: this list exists
to prevent harm, not to find whales to re-engage, and must never be used for
marketing.

    SUPABASE_PROJECT_REF=... SUPABASE_ACCESS_TOKEN=... \\
        python3 scripts/ops/responsible/outreach_candidates.py [--days 30] [--pct 0.5]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import requests

API = "https://api.supabase.com/v1/projects/{ref}/database/query"


def sql(query: str) -> list[dict]:
    r = requests.post(
        API.format(ref=os.environ["SUPABASE_PROJECT_REF"]),
        headers={
            "Authorization": f"Bearer {os.environ['SUPABASE_ACCESS_TOKEN']}",
            "Content-Type": "application/json",
        },
        json={"query": query},
        timeout=90,
    )
    if r.status_code >= 400:
        raise SystemExit(f"query failed {r.status_code}: {r.text[:400]}")
    out = r.json()
    return out if isinstance(out, list) else []


# One statement: the window's net outflow per user, the share of it that is
# still open, and whether they have already acted for themselves.
QUERY = """
WITH flows AS (
  SELECT t.user_id,
         SUM(CASE WHEN t.type = 'bet_placed' THEN t.amount_usd ELSE -t.amount_usd END) AS net_out_usd,
         SUM(CASE WHEN t.type = 'bet_placed' THEN t.amount_usd ELSE 0 END)             AS staked_usd,
         COUNT(*) FILTER (WHERE t.type = 'bet_placed')                                 AS buys,
         COUNT(DISTINCT date_trunc('day', t.created_at))                               AS active_days
  FROM public.transactions t
  WHERE t.status = 'completed'
    AND t.type IN ('bet_placed', 'bet_refunded', 'bet_won', 'bet_lost')
    AND t.created_at > now() - make_interval(days => {days})
  GROUP BY t.user_id
), deposits AS (
  SELECT d.user_id, SUM(d.amount * COALESCE(d.exchange_rate_to_usd, 0)) AS deposited_usd
  FROM public.deposits d
  WHERE d.status = 'completed' AND d.created_at > now() - make_interval(days => {days})
  GROUP BY d.user_id
)
SELECT f.user_id,
       p.settlement_currency::text AS currency,
       ROUND(f.net_out_usd, 2)   AS net_out_usd,
       ROUND(f.staked_usd, 2)    AS staked_usd,
       ROUND(COALESCE(dp.deposited_usd, 0), 2) AS deposited_usd,
       f.buys, f.active_days,
       EXISTS (SELECT 1 FROM public.play_limits l
                WHERE l.user_id = f.user_id AND l.cancelled_at IS NULL
                  AND l.effective_at <= now() AND l.amount IS NOT NULL) AS has_limit
FROM flows f
JOIN public.profiles p ON p.id = f.user_id
LEFT JOIN deposits dp ON dp.user_id = f.user_id
WHERE f.net_out_usd > 0
  -- already stopped: nothing to call about
  AND NOT EXISTS (SELECT 1 FROM public.active_play_break(f.user_id))
ORDER BY f.net_out_usd DESC
"""

CONTACT = """
SELECT id AS user_id, display_name, phone_number
FROM public.profiles WHERE id IN ({ids})
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=30, help="window, in days (default 30)")
    ap.add_argument("--pct", type=float, default=0.5, help="top share to list, in percent (default 0.5)")
    ap.add_argument("--min", type=int, default=1, help="list at least this many (default 1)")
    ap.add_argument("--with-contact", action="store_true", help="include name and phone (PII)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()

    rows = sql(QUERY.format(days=args.days))
    if not rows:
        print(f"No trading losses in the last {args.days} days. Nothing to do.")
        return 0

    # The top 0.5% of people who traded in the window, never fewer than --min.
    take = max(args.min, round(len(rows) * args.pct / 100))
    picked = rows[:take]

    if args.with_contact:
        ids = ",".join(f"'{r['user_id']}'" for r in picked)
        contact = {c["user_id"]: c for c in sql(CONTACT.format(ids=ids))}
        for r in picked:
            c = contact.get(r["user_id"], {})
            r["display_name"] = c.get("display_name")
            r["phone_number"] = c.get("phone_number")

    if args.json:
        print(json.dumps({"window_days": args.days, "traders": len(rows), "listed": len(picked),
                          "candidates": picked}, indent=2, default=str))
        return 0

    print(f"\nTop {args.pct}% by net loss, last {args.days} days "
          f"({len(picked)} of {len(rows)} who traded)\n")
    head = f"{'user':38} {'net out $':>10} {'staked $':>10} {'deposited $':>12} {'buys':>5} {'days':>5}  limit"
    print(head)
    print("-" * len(head))
    for r in picked:
        who = r.get("display_name") or r["user_id"]
        print(f"{str(who)[:38]:38} {r['net_out_usd']:>10} {r['staked_usd']:>10} "
              f"{r['deposited_usd']:>12} {r['buys']:>5} {r['active_days']:>5}  "
              f"{'yes' if r['has_limit'] else '—'}"
              + (f"  {r.get('phone_number') or ''}" if args.with_contact else ""))

    print("\nThis is a call list, not a campaign. One person, one conversation:")
    print("  ask how it is going, mention the limits and the break, offer to help set one.")
    print("  Nobody on this list should receive marketing because they are on it.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
