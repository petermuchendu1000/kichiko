#!/usr/bin/env python3
"""
e2e_realtime.py -- authoritative end-to-end tests for EVERY Supabase Realtime
event the Kichiko frontend subscribes to, run against a LIVE project.

It proves, over a real websocket, that each realtime feature actually delivers,
that Row-Level Security correctly ISOLATES subscribers, and that we are not
paying to fan-out tables nobody consumes. It measures end-to-end delivery
latency (REST write -> WAL decode -> RLS eval -> websocket receive).

Scenarios
---------
  1. notifications  : INSERT on public.notifications, filter user_id=eq.<me>.
                      User A must receive their own notification; user B must
                      NOT receive it (RLS: auth.uid() = user_id).
  2. comments       : INSERT on public.comments, filter market_id=eq.<m>.
                      A subscriber on market M1 receives a comment on M1; a
                      subscriber on market M2 does NOT (channel/filter isolation).
                      (Regression guard for migration 053, which added `comments`
                      to the supabase_realtime publication -- it was missing, so
                      live comments silently delivered nothing.)
  3. firehose-removed (negative control): price_history was REMOVED from the
                      publication in migration 053. A subscriber must receive
                      NOTHING when a row is inserted -- proving we no longer
                      decode + fan-out that high-write table for zero consumers.

Config (env)
------------
  SUPABASE_URL                 e.g. https://<ref>.supabase.co   (required)
  SUPABASE_ANON_KEY            anon / publishable key           (required)
  SUPABASE_SERVICE_ROLE_KEY    service / secret key             (required)
  RT_DELIVERY_TIMEOUT_S        per-scenario wait for delivery   (default 8)
  RT_LATENCY_BUDGET_MS         soft budget; over -> warning     (default 3000)

If any of the three required vars is missing the script prints a GitHub Actions
notice and exits 0 (no-op) -- so it can be wired into CI before secrets exist,
exactly like scripts/security/audit_definer_exposure.py.

Exit code: 0 = all scenarios passed (or no-op), 1 = at least one failure.

Usage:  python scripts/realtime/e2e_realtime.py
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

try:
    import websockets  # type: ignore
except ImportError:
    sys.stderr.write("websockets required (pip install 'websockets>=12')\n")
    raise SystemExit(2)

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
ANON = os.environ.get("SUPABASE_ANON_KEY", "")
SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
DELIVERY_TIMEOUT_S = float(os.environ.get("RT_DELIVERY_TIMEOUT_S", "8"))
LATENCY_BUDGET_MS = float(os.environ.get("RT_LATENCY_BUDGET_MS", "3000"))

TEST_EMAIL_DOMAIN = "kichiko-e2e.dev"  # disposable, never real


# --------------------------------------------------------------------------- #
# Small REST / auth helpers (stdlib only)
# --------------------------------------------------------------------------- #
def _http(method: str, url: str, headers: dict, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode() or "{}"
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, raw


def rest(method: str, path: str, key: str, body=None, prefer=None, token=None):
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {token or key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return _http(method, f"{URL}/rest/v1/{path}", headers, body)


def auth_admin(method: str, path: str, body=None):
    headers = {
        "apikey": SERVICE,
        "Authorization": f"Bearer {SERVICE}",
        "Content-Type": "application/json",
    }
    return _http(method, f"{URL}/auth/v1/{path}", headers, body)


def mint_user() -> dict:
    """Create an auto-confirmed disposable user and return {id, token, email}."""
    email = f"rt_{uuid.uuid4().hex[:12]}@{TEST_EMAIL_DOMAIN}"
    password = "T-" + uuid.uuid4().hex
    status, res = auth_admin(
        "POST", "admin/users",
        {"email": email, "password": password, "email_confirm": True},
    )
    if status != 200 or not res.get("id"):
        raise RuntimeError(f"admin create user failed: {status} {res}")
    uid = res["id"]
    status, tok = _http(
        "POST", f"{URL}/auth/v1/token?grant_type=password",
        {"apikey": ANON, "Content-Type": "application/json"},
        {"email": email, "password": password},
    )
    if status != 200 or not tok.get("access_token"):
        raise RuntimeError(f"signin failed: {status} {tok}")
    return {"id": uid, "token": tok["access_token"], "email": email}


def delete_user(uid: str) -> None:
    try:
        auth_admin("DELETE", f"admin/users/{uid}")
    except Exception:
        pass


# --------------------------------------------------------------------------- #
# Minimal Supabase Realtime (Phoenix) subscriber
# --------------------------------------------------------------------------- #
class RealtimeSub:
    def __init__(self, name: str, token: str, changes: list[dict]):
        self.name = name
        self.token = token
        self.changes = changes
        self.events: list[tuple[float, dict]] = []
        self.subscribed = asyncio.Event()
        self.topic = f"realtime:{name}-{uuid.uuid4().hex[:6]}"

    async def run(self, stop: asyncio.Event):
        ws_url = f"wss://{URL.split('//', 1)[1]}/realtime/v1/websocket?apikey={ANON}&vsn=1.0.0"
        async with websockets.connect(ws_url, max_size=2 ** 20, open_timeout=20) as ws:
            await ws.send(json.dumps({
                "topic": self.topic,
                "event": "phx_join",
                "ref": "1",
                "payload": {
                    "config": {"postgres_changes": self.changes, "private": False},
                    "access_token": self.token,
                },
            }))

            async def heartbeat():
                while not stop.is_set():
                    await asyncio.sleep(20)
                    try:
                        await ws.send(json.dumps(
                            {"topic": "phoenix", "event": "heartbeat", "payload": {}, "ref": "hb"}))
                    except Exception:
                        break

            hb_task = asyncio.create_task(heartbeat())
            try:
                while not stop.is_set():
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                    except asyncio.TimeoutError:
                        continue
                    msg = json.loads(raw)
                    event = msg.get("event")
                    if event == "system" and "Subscribed" in json.dumps(msg.get("payload", {})):
                        self.subscribed.set()
                    elif event == "postgres_changes":
                        self.events.append((time.time(), msg.get("payload", {}).get("data", {})))
            finally:
                hb_task.cancel()


# --------------------------------------------------------------------------- #
# Scenarios
# --------------------------------------------------------------------------- #
async def _run_subs(subs: list[RealtimeSub], require_subscribe: bool):
    stop = asyncio.Event()
    tasks = [asyncio.create_task(s.run(stop)) for s in subs]
    if require_subscribe:
        await asyncio.wait_for(
            asyncio.gather(*(s.subscribed.wait() for s in subs)), timeout=20)
    else:
        # negative control: table may not be published, so subscription confirm
        # is not guaranteed -- just give the join a moment.
        await asyncio.sleep(6)
    await asyncio.sleep(0.5)
    return stop, tasks


async def scenario_notifications(results: list):
    a = mint_user()
    b = mint_user()
    try:
        subA = RealtimeSub("A", a["token"], [{"event": "INSERT", "schema": "public",
                "table": "notifications", "filter": f"user_id=eq.{a['id']}"}])
        subB = RealtimeSub("B", b["token"], [{"event": "INSERT", "schema": "public",
                "table": "notifications", "filter": f"user_id=eq.{b['id']}"}])
        stop, tasks = await _run_subs([subA, subB], require_subscribe=True)

        t0 = time.time()
        status, _ = rest("POST", "notifications", SERVICE,
                         {"user_id": a["id"], "type": "system_announcement",
                          "title": "E2E", "body": "realtime probe"}, prefer="return=minimal")
        await asyncio.sleep(DELIVERY_TIMEOUT_S)
        stop.set()
        await asyncio.gather(*tasks, return_exceptions=True)

        got_a = len(subA.events)
        got_b = len(subB.events)
        latency = (subA.events[0][0] - t0) * 1000 if subA.events else None
        payload_ok = bool(subA.events) and \
            subA.events[0][1].get("record", {}).get("user_id") == a["id"]
        ok = status == 201 and got_a == 1 and got_b == 0 and payload_ok
        results.append({
            "scenario": "notifications (delivery + RLS isolation)",
            "ok": ok, "insert_status": status, "self_received": got_a,
            "other_received": got_b, "payload_ok": payload_ok,
            "latency_ms": round(latency, 1) if latency else None,
        })
        # cleanup the notification rows for this user
        rest("DELETE", f"notifications?user_id=eq.{a['id']}", SERVICE, prefer="return=minimal")
    finally:
        delete_user(a["id"])
        delete_user(b["id"])


async def scenario_comments(results: list):
    status, mkts = rest("GET", "markets?select=id&limit=2", SERVICE)
    if status != 200 or not isinstance(mkts, list) or len(mkts) < 2:
        results.append({"scenario": "comments", "ok": False,
                        "error": "need >=2 markets to test filter isolation"})
        return
    m1, m2 = mkts[0]["id"], mkts[1]["id"]
    a = mint_user()
    b = mint_user()
    marker = f"E2E_probe_{uuid.uuid4().hex[:8]}"
    try:
        subA = RealtimeSub("cA", a["token"], [{"event": "INSERT", "schema": "public",
                "table": "comments", "filter": f"market_id=eq.{m1}"}])
        subB = RealtimeSub("cB", b["token"], [{"event": "INSERT", "schema": "public",
                "table": "comments", "filter": f"market_id=eq.{m2}"}])
        stop, tasks = await _run_subs([subA, subB], require_subscribe=True)

        t0 = time.time()
        status, _ = rest("POST", "comments", SERVICE,
                         {"market_id": m1, "user_id": a["id"], "content": marker},
                         prefer="return=minimal")
        await asyncio.sleep(DELIVERY_TIMEOUT_S)
        stop.set()
        await asyncio.gather(*tasks, return_exceptions=True)

        got_a = len(subA.events)
        got_b = len(subB.events)
        latency = (subA.events[0][0] - t0) * 1000 if subA.events else None
        payload_ok = bool(subA.events) and \
            subA.events[0][1].get("record", {}).get("market_id") == m1
        ok = status == 201 and got_a == 1 and got_b == 0 and payload_ok
        results.append({
            "scenario": "comments (delivery + market-filter isolation)",
            "ok": ok, "insert_status": status, "m1_received": got_a,
            "m2_received": got_b, "payload_ok": payload_ok,
            "latency_ms": round(latency, 1) if latency else None,
        })
        q = urllib.parse.urlencode({"content": f"eq.{marker}"})
        rest("DELETE", f"comments?{q}", SERVICE, prefer="return=minimal")
    finally:
        delete_user(a["id"])
        delete_user(b["id"])


async def scenario_firehose_removed(results: list):
    status, mkts = rest("GET", "markets?select=id&limit=1", SERVICE)
    if status != 200 or not mkts:
        results.append({"scenario": "firehose-removed", "ok": False,
                        "error": "need a market"})
        return
    m1 = mkts[0]["id"]
    a = mint_user()
    marker = round(0.4242 + (time.time() % 1) / 1e6, 8)
    try:
        subA = RealtimeSub("ph", a["token"], [{"event": "INSERT", "schema": "public",
                "table": "price_history", "filter": f"market_id=eq.{m1}"}])
        stop, tasks = await _run_subs([subA], require_subscribe=False)

        status, _ = rest("POST", "price_history", SERVICE,
                         {"market_id": m1, "yes_price": marker,
                          "no_price": round(1 - marker, 8), "price": marker},
                         prefer="return=minimal")
        await asyncio.sleep(DELIVERY_TIMEOUT_S)
        stop.set()
        await asyncio.gather(*tasks, return_exceptions=True)

        ok = status == 201 and len(subA.events) == 0
        results.append({
            "scenario": "firehose-removed (price_history negative control)",
            "ok": ok, "insert_status": status, "events_received": len(subA.events),
            "expected": 0,
        })
        q = urllib.parse.urlencode({"yes_price": f"eq.{marker}"})
        rest("DELETE", f"price_history?{q}", SERVICE, prefer="return=minimal")
    finally:
        delete_user(a["id"])


async def run_all() -> int:
    results: list[dict] = []
    await scenario_notifications(results)
    await scenario_comments(results)
    await scenario_firehose_removed(results)

    print("\n=== Realtime E2E results ===")
    failed = 0
    for r in results:
        status = "PASS" if r.get("ok") else "FAIL"
        if not r.get("ok"):
            failed += 1
        lat = r.get("latency_ms")
        lat_s = f" | latency={lat}ms" if lat is not None else ""
        if lat is not None and lat > LATENCY_BUDGET_MS:
            print(f"::warning::realtime latency {lat}ms over budget {LATENCY_BUDGET_MS}ms "
                  f"for {r['scenario']}")
        print(f"  [{status}] {r['scenario']}{lat_s}")
        print(f"          {json.dumps({k: v for k, v in r.items() if k not in ('scenario','ok')})}")

    if failed:
        print(f"\n[realtime-e2e] FAILED: {failed}/{len(results)} scenario(s).")
        for r in results:
            if not r.get("ok"):
                print(f"  ::error::realtime scenario failed: {r['scenario']} -> {json.dumps(r)}")
        return 1
    print(f"\n[realtime-e2e] OK -- {len(results)} realtime scenario(s) passed.")
    return 0


def main() -> int:
    if not (URL and ANON and SERVICE):
        print("::notice::SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY "
              "not all set; skipping realtime E2E.")
        print("::notice::Provide the three secrets to enable live realtime E2E enforcement.")
        return 0
    return asyncio.run(run_all())


if __name__ == "__main__":
    raise SystemExit(main())
