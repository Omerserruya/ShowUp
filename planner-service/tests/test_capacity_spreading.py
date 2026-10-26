"""Daily-capacity spreading scenarios (pure core + release-time helpers).

    cd planner-service && python3 tests/test_capacity_spreading.py

Covers the review findings:
  1. replans start each day at 0 -> prefill with already-used volume
  2/3. overload of time-critical rounds -> carry-forward, unplaced reported
  4. release_at inside the send window; closed days skipped
  5. event-date caps on overflow; tie-break by event date then created_at
"""
import os
import sys
from datetime import date, datetime, timedelta, timezone

os.environ.setdefault("SEND_WINDOW", "sun-thu=09:00-21:00;fri=09:00-14:00;sat=20:00-21:00")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from planner.config import PlannerConfig, ChannelLimits
from planner.models import CampaignRequest, CampaignType, PlanContext
from planner.windows import resolve_window
from planner.engine import Planner
from planner.send_window import adjust_minute_into_window, day_is_sendable

FAIL = 0
PASS = 0


def check(name, cond, extra=""):
    global FAIL, PASS
    ok = bool(cond)
    PASS += ok
    FAIL += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{('  ' + str(extra)) if extra and not ok else ''}")


def cfg(cap=1000, margin=15.0):
    return PlannerConfig(
        safety_margin_percent=margin, max_early_send_days=5, max_late_send_days=2,
        interval_seconds=20, strategy="deterministic", horizon_days=60,
        channels={"whatsapp": ChannelLimits("whatsapp", 10000, cap)},
    )


def req(cid, ctype, target, volume, now, config, event_day=None, priority=50, created=None, original=None):
    return CampaignRequest(
        cid, f"ev-{cid}", "whatsapp", ctype, priority, volume,
        resolve_window(target, ctype, config, now, event_date=event_day, original_target=original),
        event_date=event_day, created_at=created,
    )


# ---------------------------------------------------------------------------
print("== 1. 5 events x 400 on the same day, replanned many times (prefill) ==")
config = cfg()
CAP = config.planner_daily_capacity("whatsapp")          # 850
today = date(2026, 11, 2)                                  # a Monday
event_day = today + timedelta(days=10)
remaining = {f"e{i}": 400 for i in range(5)}
sent_by_day = {}


def simulate_day(day, runs, use_prefill=True):
    """Each run = one planner cycle followed by the scheduler releasing (and the
    worker sending) everything planned for `day`."""
    max_seen = 0
    for _ in range(runs):
        reqs = [req(cid, CampaignType.INVITATION, today, v, day, config, event_day=event_day,
                    created=datetime(2026, 10, 1, tzinfo=timezone.utc) + timedelta(minutes=i))
                for i, (cid, v) in enumerate(sorted(remaining.items())) if v > 0]
        pre = {"whatsapp": {day: sent_by_day.get(day, 0)}} if use_prefill else {}
        res = Planner(config).plan(reqs, day, context=PlanContext(prefill=pre))
        load = res.day_load.get("whatsapp", {})
        max_seen = max([max_seen] + list(load.values()))
        for a in res.allocations:
            n = a.by_day.get(day, 0)
            remaining[a.campaign_id] -= n
            sent_by_day[day] = sent_by_day.get(day, 0) + n
    return max_seen


peak = simulate_day(today, runs=6)
check(f"same-day total after 6 replans <= capacity ({CAP})", sent_by_day[today] <= CAP, sent_by_day[today])
check("plan never shows a day over capacity (prefill included)", peak <= CAP, peak)
d = today
for _ in range(5):
    d += timedelta(days=1)
    simulate_day(d, runs=3)
check("every day stays <= capacity across the whole rollout",
      all(v <= CAP for v in sent_by_day.values()), sent_by_day)
check("all 2000 messages eventually sent", sum(remaining.values()) == 0, remaining)
check("rollout finished before the event", max(sent_by_day) < event_day)

# Regression demo: the OLD behaviour (no prefill) over-sends on the same day.
remaining = {f"e{i}": 400 for i in range(5)}
sent_by_day = {}
simulate_day(today, runs=6, use_prefill=False)
check("(regression) without prefill the same day would exceed capacity", sent_by_day[today] > CAP,
      sent_by_day[today])

# Prefill already over capacity (e.g. a manual blast): plan adds nothing that day.
r = req("x", CampaignType.INVITATION, today, 100, today, config, event_day=event_day)
res = Planner(config).plan([r], today, context=PlanContext(prefill={"whatsapp": {today: 900}}))
check("prefill over capacity -> nothing more placed on that day", res.allocations[0].by_day.get(today) is None)

# ---------------------------------------------------------------------------
print("== 2. 3 final reminders x 600 (time-critical overload) ==")
T = today + timedelta(days=3)          # final reminder the day before the event
EV = T + timedelta(days=1)
fr = [req(f"fr{i}", CampaignType.LAST_REMINDER, T, 600, today, config, event_day=EV,
          created=datetime(2026, 10, 1, i, tzinfo=timezone.utc)) for i in range(3)]
res = Planner(config).plan(fr, today)
load = res.day_load["whatsapp"]
check("no day over capacity", all(v <= CAP for v in load.values()), load)
check("overflow carried to the event day (morning), never after it",
      set(load) <= {T, EV} and load.get(EV, 0) > 0, load)
unplaced = sum(a.unplaced for a in res.allocations)
check("what cannot fit before the deadline is reported unplaced (1800-1700=100)", unplaced == 1800 - 2 * CAP,
      unplaced)
by = {a.campaign_id: a for a in res.allocations}
check("earliest-created final reminder fully placed on its day", by["fr0"].by_day == {T: 600})
check("unplaced lands on the latest-created one", by["fr2"].unplaced == unplaced and by["fr0"].unplaced == 0)

# ---------------------------------------------------------------------------
print("== 3. Event-date caps ==")
EV = today + timedelta(days=4)
inv = req("inv", CampaignType.INVITATION, EV - timedelta(days=2), 3000, today, config, event_day=EV)
check("invitation window capped at event-1", inv.window.latest == EV - timedelta(days=1)
      and inv.window.hard_latest == EV - timedelta(days=1))
res = Planner(config).plan([inv], today)
check("pre-event overflow never placed on/after the event day",
      all(dd < EV for dd in res.allocations[0].by_day), res.allocations[0].by_day)
rem = req("rem", CampaignType.REMINDER, EV - timedelta(days=1), 2000, today, config, event_day=EV)
res = Planner(config).plan([rem], today)
check("reminder never placed on the event day", all(dd < EV for dd in res.allocations[0].by_day))
owner_ev = req("evday", CampaignType.REMINDER, EV, 100, today, config, event_day=EV)
check("reminder the owner put ON the event day keeps that day", owner_ev.window.allows(EV)
      and not owner_ev.window.allows(EV + timedelta(days=1)))
ty = req("ty", CampaignType.THANK_YOU, EV + timedelta(days=1), 100, today, config, event_day=EV)
check("thank-you may go after the event", ty.window.allows(EV + timedelta(days=2)))
late = req("late", CampaignType.INVITATION, today, 100, today, config, event_day=today - timedelta(days=1),
           original=today - timedelta(days=5))
check("pre-event round for a past event -> empty window (never planned)", late.window.is_empty)
missed = req("missed", CampaignType.INVITATION, today, 100, today, config, event_day=today,
             original=today - timedelta(days=1))
check("invitation that missed event-1 is NOT pushed onto the event day", missed.window.is_empty)

# ---------------------------------------------------------------------------
print("== 4. Tie-break: sooner event, then earlier created_at (not UUID) ==")
config0 = cfg(margin=0.0, cap=100)
TT = today + timedelta(days=2)
a = req("zzzz", CampaignType.INVITATION, TT, 100, today, config0, event_day=today + timedelta(days=5))
b = req("aaaa", CampaignType.INVITATION, TT, 100, today, config0, event_day=today + timedelta(days=20))
res = Planner(config0).plan([b, a], today)
by = {x.campaign_id: x for x in res.allocations}
check("sooner event keeps the target day (despite larger UUID)", by["zzzz"].by_day.get(TT) == 100)
ev = today + timedelta(days=9)
c1 = req("ffff", CampaignType.INVITATION, TT, 100, today, config0, event_day=ev,
         created=datetime(2026, 10, 1, tzinfo=timezone.utc))
c2 = req("0000", CampaignType.INVITATION, TT, 100, today, config0, event_day=ev,
         created=datetime(2026, 10, 2, tzinfo=timezone.utc))
res = Planner(config0).plan([c2, c1], today)
by = {x.campaign_id: x for x in res.allocations}
check("same event date -> earlier-created keeps the target day", by["ffff"].by_day.get(TT) == 100
      and by["0000"].by_day.get(TT) is None)

# ---------------------------------------------------------------------------
print("== 5. Send window: release_at inside an open window; closed days skipped ==")
mon, fri, sat = date(2026, 11, 2), date(2026, 11, 6), date(2026, 11, 7)
check("weekday 19:30 kept", adjust_minute_into_window(mon, 19 * 60 + 30) == 19 * 60 + 30)
check("weekday 07:00 -> 09:00", adjust_minute_into_window(mon, 7 * 60) == 9 * 60)
check("weekday 22:30 -> 09:00 (day's window start)", adjust_minute_into_window(mon, 22 * 60 + 30) == 9 * 60)
check("Friday 15:00 -> 09:00 (before Shabbat close)", adjust_minute_into_window(fri, 15 * 60) == 9 * 60)
check("Saturday 10:00 -> 20:00 (after Shabbat)", adjust_minute_into_window(sat, 10 * 60) == 20 * 60)
check("Friday after 14:00 today -> not sendable", not day_is_sendable(fri, 15 * 60))
check("Friday before 14:00 -> sendable", day_is_sendable(fri, 10 * 60))
check("weekday after 21:00 today -> not sendable", not day_is_sendable(mon, 21 * 60 + 5))
r = req("now", CampaignType.INVITATION, fri, 50, fri, config, event_day=fri + timedelta(days=10))
res = Planner(config).plan([r], fri, context=PlanContext(closed_days={fri}))
check("'send now' on Friday 15:00 -> planned on the next open day, not Friday",
      fri not in res.allocations[0].by_day and res.allocations[0].placed == 50, res.allocations[0].by_day)

try:
    import runtime  # needs psycopg2
except ImportError as exc:
    print(f"  SKIP runtime.release_instant checks: {exc}")
else:
    IL = runtime.local_tz()
    sched = datetime(2026, 11, 6, 15, 0, tzinfo=IL)   # owner picked Friday 15:00
    ri = runtime.release_instant(fri, sched).astimezone(IL)
    check(f"release_instant Friday 15:00 -> 09:00 local (got {ri.time()})", ri.hour == 9 and ri.minute == 0)
    ri = runtime.release_instant(sat, sched).astimezone(IL)
    check(f"release_instant Saturday -> 20:00 local (got {ri.time()})", ri.hour == 20)
    sched = datetime(2026, 11, 2, 19, 0, tzinfo=IL)
    evd = date(2026, 11, 4)
    ri = runtime.release_instant(evd, sched, event_day=evd, target=date(2026, 11, 3)).astimezone(IL)
    check(f"final reminder carried onto event day -> morning 09:00 (got {ri.time()})", ri.hour == 9)
    ri = runtime.release_instant(evd, sched, event_day=evd, target=evd).astimezone(IL)
    check("owner-chosen event-day time kept (19:00)", ri.hour == 19)

print(f"\nRESULT: {PASS}/{PASS + FAIL} checks passed")
sys.exit(1 if FAIL else 0)
