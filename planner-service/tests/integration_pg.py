"""Integration test: planner runtime + scheduler release guard on a REAL Postgres.

Needs a throwaway database (DESTRUCTIVE: creates/drops tables). Env:
    DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME   (the throwaway DB)
    INTEGRATION_OK=1                               (safety latch)
Run from the repo root inside an image that has psycopg2 + tenacity + uvicorn
(e.g. the scheduler image):
    PYTHONPATH=/work python planner-service/tests/integration_pg.py
"""
import importlib.util
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

if os.getenv("INTEGRATION_OK") != "1":
    print("SKIP: set INTEGRATION_OK=1 and point DB_* at a THROWAWAY database")
    sys.exit(0)

os.environ["SEND_WINDOW"] = "off"            # deterministic regardless of wall clock
os.environ["META_NEW_CONVERSATIONS_PER_24H"] = "1000"
os.environ["PLANNER_SAFETY_MARGIN_PERCENT"] = "15"
os.environ.pop("WA_API_B", None)

HERE = os.path.dirname(os.path.abspath(__file__))
PLANNER = os.path.dirname(HERE)
REPO = os.path.dirname(PLANNER)
sys.path.insert(0, PLANNER)
sys.path.insert(0, REPO)

import psycopg2  # noqa: E402

import runtime  # noqa: E402
import meta_tier  # noqa: E402
from planner.config import load_config  # noqa: E402
from planner.engine import Planner  # noqa: E402


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


sched_db = _load("sched_db", os.path.join(REPO, "scheduler-service", "db.py"))
planner_main = _load("planner_main", os.path.join(PLANNER, "main.py"))

FAIL = 0
PASS = 0


def check(name, cond, extra=""):
    global FAIL, PASS
    ok = bool(cond)
    PASS += ok
    FAIL += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{('  ' + str(extra)) if extra and not ok else ''}")


conn = psycopg2.connect(runtime.db_url())
conn.autocommit = True
cur = conn.cursor()
for t in ("campaign_releases", "planner_runs", "planner_state", "messages_sent", "guest_tags", "guests",
          "campaigns", "events", "ops_errors", "owner_notifications"):
    cur.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
cur.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")
# Minimal core tables (the scheduler's bootstrap DDL + the columns core adds).
sched_db.ensure_tables(conn)
for stmt in (
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS plan_id VARCHAR(40)",
    "ALTER TABLE events ALTER COLUMN event_date TYPE TIMESTAMPTZ",
    "ALTER TABLE campaigns ALTER COLUMN schedule_time TYPE TIMESTAMPTZ",
    "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS recipient_count INTEGER",
    "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS stage_id VARCHAR(40)",
    "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS audience VARCHAR(20)",
    "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS audience_filter JSONB",
    "ALTER TABLE guests ADD COLUMN IF NOT EXISTS opted_out_at TIMESTAMPTZ",
    "CREATE TABLE IF NOT EXISTS guest_tags (guest_id UUID, tag_id UUID)",
):
    cur.execute(stmt)
from shared.domain.delivery import ensure_messages_sent_schema  # noqa: E402
ensure_messages_sent_schema(cur)
runtime.ensure_planner_schema(conn)

NOW = datetime.now(timezone.utc)


def make_event(days_ahead, guests, plan="premium"):
    eid = str(uuid.uuid4())
    cur.execute("INSERT INTO events (id, name, event_date, active, plan_id) VALUES (%s,'E',%s,true,%s)",
                (eid, NOW + timedelta(days=days_ahead), plan))
    for i in range(guests):
        cur.execute("INSERT INTO guests (id, event_id, name, phone) VALUES (%s,%s,'G',%s)",
                    (str(uuid.uuid4()), eid, f"+97250{i:07d}"))
    return eid


def make_campaign(eid, stage, when, rc=None, created=None, channel="whatsapp"):
    cid = str(uuid.uuid4())
    cur.execute(
        "INSERT INTO campaigns (id, event_id, name, template, channel, schedule_time, status, recipient_count, "
        "stage_id, audience, created_at) VALUES (%s,%s,%s,'t',%s,%s,'pending',%s,%s,'everyone',%s)",
        (cid, eid, stage, channel, when, rc, stage, created or NOW))
    return cid


def plan():
    planner = Planner(planner_main.effective_config(conn, load_config()))
    planner_main.plan_once(conn, planner)
    return planner


def simulate_worker(rows):
    """Execute claimed releases like campaign-worker: claim `count` (or all for a
    final batch) not-yet-messaged guests, mark the release sent."""
    for r in rows:
        cur.execute("SELECT event_id FROM campaigns WHERE id=%s", (r["campaign_id"],))
        eid = cur.fetchone()[0]
        limit = None if r.get("is_final") else int(r["count"])
        cur.execute(
            "SELECT g.id FROM guests g WHERE g.event_id=%s AND NOT EXISTS (SELECT 1 FROM messages_sent m "
            "WHERE m.campaign_id=%s AND m.guest_id=g.id) ORDER BY g.id" + (" LIMIT %s" if limit else ""),
            (eid, r["campaign_id"], limit) if limit else (eid, r["campaign_id"]))
        gids = [x[0] for x in cur.fetchall()]
        for g in gids:
            cur.execute("INSERT INTO messages_sent (campaign_id, guest_id, status) VALUES (%s,%s,'accepted')",
                        (r["campaign_id"], g))
        cur.execute("UPDATE campaign_releases SET status='sent', count=%s, updated_at=NOW() WHERE id=%s",
                    (len(gids), r["release_id"]))


def today_local():
    return runtime.local_today()


print("== A. 5 events x 400 'send now' with recipient_count 0/NULL ==")
camps = []
for i in range(5):
    eid = make_event(10, 400)
    camps.append(make_campaign(eid, "invitation", NOW - timedelta(minutes=1), rc=(0 if i % 2 else None),
                               created=NOW - timedelta(days=5 - i)))
check("fast-path probe sees unplanned due campaigns", runtime.has_unplanned_due(conn))
plan()
cur.execute("SELECT COALESCE(SUM(count),0) FROM campaign_releases WHERE status='pending'")
check("recipient_count 0/NULL still planned from live audience (2000 total)", cur.fetchone()[0] == 2000)
cur.execute("SELECT COALESCE(SUM(count),0) FROM campaign_releases WHERE release_date=%s", (today_local(),))
check("today's planned volume <= 850", cur.fetchone()[0] <= 850)
check("legacy path never sends whatsapp campaigns", len(sched_db.fetch_and_mark_due(conn)) == 0)
deferred = []
rows = sched_db.fetch_and_mark_due_releases(conn, deferred_out=deferred)
check("scheduler releases <= 850 today", sum(r["count"] for r in rows) <= 850, sum(r["count"] for r in rows))
simulate_worker(rows)
for _ in range(4):   # many planner cycles + scheduler cycles on the same day
    plan()
    more = sched_db.fetch_and_mark_due_releases(conn, deferred_out=deferred)
    simulate_worker(more)
cur.execute("SELECT COUNT(*) FROM messages_sent WHERE sent_at > NOW() - INTERVAL '24 hours'")
sent24 = cur.fetchone()[0]
check(f"after 5 replans the rolling 24h total stays <= 850 (got {sent24})", sent24 <= 850)
cur.execute("SELECT COALESCE(SUM(count),0) FROM campaign_releases WHERE status='pending'")
check("the rest (1150) is planned on later days", cur.fetchone()[0] == 2000 - sent24)
cur.execute("SELECT MIN(release_date) FROM campaign_releases WHERE status='pending'")
check("nothing more pending today", cur.fetchone()[0] > today_local())

print("== B. Rolling 24h guard defers a due batch ==")
cur.execute("SELECT id FROM campaign_releases WHERE status='pending' ORDER BY release_date LIMIT 1")
rid = cur.fetchone()[0]
cur.execute("UPDATE campaign_releases SET release_at = NOW() - INTERVAL '1 minute' WHERE id=%s", (rid,))
deferred = []
rows = sched_db.fetch_and_mark_due_releases(conn, deferred_out=deferred)
check("over-capacity batch not released", not rows)
check("...it is deferred with release_at pushed forward", deferred and str(deferred[0]["id"]) == str(rid))
cur.execute("SELECT release_at > NOW() + INTERVAL '25 minutes', status FROM campaign_releases WHERE id=%s", (rid,))
pushed, st = cur.fetchone()
check("release_at moved ~30 min ahead, still pending", pushed and st == "pending")
# Age the sends out of the 24h window -> the same batch is released.
cur.execute("UPDATE messages_sent SET sent_at = sent_at - INTERVAL '25 hours'")
cur.execute("UPDATE campaign_releases SET release_at = NOW() - INTERVAL '1 minute' WHERE id=%s", (rid,))
rows = sched_db.fetch_and_mark_due_releases(conn)
check("after the 24h window ages out the batch is released", rows and str(rows[0]["release_id"]) == str(rid))
simulate_worker(rows)

print("== C. 3 final reminders x 600, capacity unplaced -> recorded ==")
eid = make_event(1, 600)
eid2 = make_event(1, 600)
eid3 = make_event(1, 600)
cur.execute("UPDATE messages_sent SET sent_at = sent_at - INTERVAL '48 hours'")
cur.execute("DELETE FROM campaign_releases WHERE status='pending'")
cur.execute("UPDATE campaigns SET status='sent' WHERE status='pending'")
frs = [make_campaign(e, "final_reminder", NOW - timedelta(minutes=1), created=NOW - timedelta(hours=3 - k))
       for k, e in enumerate((eid, eid2, eid3))]
plan()
cur.execute("SELECT release_date, SUM(count) FROM campaign_releases WHERE status='pending' GROUP BY 1")
per_day = dict(cur.fetchall())
check("final reminders never exceed 850/day", all(v <= 850 for v in per_day.values()), per_day)
cur.execute("SELECT id, status_reason FROM campaigns WHERE id = ANY(%s::uuid[])", (frs,))
reasons = {str(a): b for a, b in cur.fetchall()}
check("an overflowing final reminder is marked capacity_unplaced",
      "capacity_unplaced" in reasons.values(), reasons)
cur.execute("SELECT COUNT(*) FROM ops_errors WHERE error_type='campaign_capacity_unplaced'")
n_ops = cur.fetchone()[0]
check("ops_errors row recorded for the unplaced volume", n_ops >= 1)
plan()
cur.execute("SELECT COUNT(*) FROM ops_errors WHERE error_type='campaign_capacity_unplaced'")
check("not re-recorded on every replan", cur.fetchone()[0] == n_ops)
cur.execute("SELECT COUNT(*) FROM campaign_releases r JOIN campaigns c ON c.id=r.campaign_id "
            "WHERE r.status='pending' AND r.is_final AND c.status_reason='capacity_unplaced'")
check("a partially-unplaced campaign gets NO final (unlimited) batch", cur.fetchone()[0] == 0)
check("legacy path still never sends them", len(sched_db.fetch_and_mark_due(conn)) == 0)

print("== D. Deadline passed -> failed + ops; dead/finished campaigns ==")
past_eid = make_event(-1, 5)
dead = make_campaign(past_eid, "invitation", NOW - timedelta(days=3))
plan()
cur.execute("SELECT status, status_reason FROM campaigns WHERE id=%s", (dead,))
check("invitation for a past event -> failed/deadline_passed", cur.fetchone() == ("failed", "deadline_passed"))
cur.execute("SELECT COUNT(*) FROM campaign_releases WHERE campaign_id=%s", (dead,))
check("...and has no releases", cur.fetchone()[0] == 0)
# Started campaign with nothing left -> handed to the finalizer.
e5 = make_event(10, 3)
c5 = make_campaign(e5, "reminder", NOW - timedelta(minutes=1))
cur.execute("SELECT id FROM guests WHERE event_id=%s", (e5,))
for (g,) in cur.fetchall():
    cur.execute("INSERT INTO messages_sent (campaign_id, guest_id, status) VALUES (%s,%s,'accepted')", (c5, g))
plan()
cur.execute("SELECT status FROM campaigns WHERE id=%s", (c5,))
check("started campaign with 0 remaining -> 'sending' (finalizer resolves)", cur.fetchone()[0] == "sending")
# Empty audience, never started -> planned with 1 so the worker's 0-guest guard runs.
e6 = make_event(10, 0)
c6 = make_campaign(e6, "invitation", NOW - timedelta(minutes=1))
plan()
cur.execute("SELECT SUM(count), BOOL_AND(is_final) FROM campaign_releases WHERE campaign_id=%s", (c6,))
check("0-guest campaign gets a single final probe batch (worker parks it as draft)",
      cur.fetchone() == (1, True))

print("== E. Meta tier + quality, planner_runs cleanup ==")
meta_tier.refresh(conn, fetch=lambda: ("TIER_250", "YELLOW", None))
p = Planner(planner_main.effective_config(conn, load_config()))
check("capacity = min(env 1000, TIER_250) minus 15% = 212", p.config.planner_daily_capacity("whatsapp") == 212)
cur.execute("SELECT planner_capacity FROM planner_state WHERE id=1")
check("scheduler guard reads the same capacity", cur.fetchone()[0] == 212)
cur.execute("SELECT COUNT(*) FROM ops_errors WHERE error_type='meta_quality_rating'")
check("YELLOW quality recorded in ops_errors", cur.fetchone()[0] == 1)
meta_tier.refresh(conn, fetch=lambda: ("TIER_250", "YELLOW", None))
cur.execute("SELECT COUNT(*) FROM ops_errors WHERE error_type='meta_quality_rating'")
check("unchanged quality not re-recorded", cur.fetchone()[0] == 1)
meta_tier.refresh(conn, fetch=lambda: (None, None, "boom"))
cur.execute("SELECT meta_tier, meta_error FROM planner_state WHERE id=1")
row = cur.fetchone()
check("fetch failure keeps the last known tier", row[0] == "TIER_250" and row[1] == "boom")
cur.execute("INSERT INTO planner_runs (ran_at, strategy) VALUES (NOW() - INTERVAL '8 days', 'old')")
check("planner_runs older than 7 days removed", runtime.cleanup_planner_runs(conn) >= 1)
cur.execute("SELECT COUNT(*) FROM planner_runs WHERE strategy='old'")
check("...none left", cur.fetchone()[0] == 0)

print(f"\nRESULT: {PASS}/{PASS + FAIL} checks passed")
sys.exit(1 if FAIL else 0)
