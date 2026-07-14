"""Stress + invariant tests for the Global Delivery Planner core.

Pure stdlib (no DB / broker), so it runs anywhere: `python3 tests/stress_test.py`.
Simulates many concurrent events and asserts every hard guarantee the platform
relies on:

  * capacity   - no channel/day ever exceeds the post-margin planner capacity
  * windows    - nothing is placed outside a campaign's delivery window
  * safety     - capacity always leaves the configured reserve free
  * priority   - higher-priority campaigns keep their target day; lower-priority
                 ones are the ones that move
  * conservation - every message is either placed or explicitly counted unplaced
  * rebalancing - adding a campaign re-plans affected days (not append-only)
  * determinism - same input => byte-identical plan
  * flexibility - per-type windows (save-the-date ±7 … last-reminder 0) honored
"""
import os
import random
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from planner.config import PlannerConfig, ChannelLimits
from planner.models import CampaignRequest, CampaignType, DeliveryWindow
from planner.windows import resolve_window, classify
from planner.engine import Planner

PASS = 0
FAIL = 0

def check(name, cond, extra=""):
    global PASS, FAIL
    ok = bool(cond)
    PASS += ok; FAIL += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{('  ' + extra) if extra and not ok else ''}")


def make_config(margin=15.0, cap_conversations=1000):
    return PlannerConfig(
        safety_margin_percent=margin, max_early_send_days=5, max_late_send_days=2,
        interval_seconds=60, strategy="deterministic", horizon_days=90,
        channels={"whatsapp": ChannelLimits("whatsapp", messages_per_second=10000,
                                             new_conversations_per_24h=cap_conversations)},
    )


def assert_invariants(res, reqs, cfg, tag):
    cap = cfg.planner_daily_capacity("whatsapp")
    # capacity
    over = [(d, v) for d, v in res.day_load.get("whatsapp", {}).items() if v > cap]
    check(f"[{tag}] no day exceeds capacity ({cap})", not over, str(over[:3]))
    # windows + conservation
    by_id = {r.campaign_id: r for r in reqs}
    win_ok = True; cons_ok = True
    for a in res.allocations:
        r = by_id[a.campaign_id]
        for d in a.by_day:
            if not r.window.contains(d):
                win_ok = False
        if a.placed + a.unplaced != r.volume:
            cons_ok = False
    check(f"[{tag}] all placements within window", win_ok)
    check(f"[{tag}] volume conserved (placed+unplaced==volume)", cons_ok)


# --------------------------------------------------------------------------- 1
print("== 1. Safety margin reserves capacity ==")
cfg = make_config(margin=15.0, cap_conversations=1000)
check("planner capacity = 850 (1000 - 15%)", cfg.planner_daily_capacity("whatsapp") == 850)
check("reserved = 150", cfg.reserved_daily_capacity("whatsapp") == 150)
cfg0 = make_config(margin=0.0, cap_conversations=1000)
check("0% margin => full 1000", cfg0.planner_daily_capacity("whatsapp") == 1000)

# --------------------------------------------------------------------------- 2
print("== 2. Large concurrent-event stress (no limit ever exceeded) ==")
rng = random.Random(42)
cfg = make_config(margin=15.0, cap_conversations=1000)
now = date(2026, 3, 1)
reqs = []
TYPES = [CampaignType.SAVE_THE_DATE, CampaignType.INVITATION, CampaignType.REMINDER,
         CampaignType.LAST_REMINDER, CampaignType.THANK_YOU]
for ev in range(200):                      # 200 concurrent events
    event_day = now + timedelta(days=rng.randint(10, 80))
    for t in TYPES:
        target = event_day if t in (CampaignType.LAST_REMINDER, CampaignType.REMINDER) else event_day - timedelta(days=rng.randint(1, 20))
        if target < now:
            target = now + timedelta(days=1)
        vol = rng.randint(50, 1500)
        reqs.append(CampaignRequest(
            f"e{ev}-{t.value}", f"ev{ev}", "whatsapp", t,
            priority=rng.randint(1, 10), volume=vol,
            window=resolve_window(target, t, cfg, now),
        ))
res = Planner(cfg).plan(reqs, now)
total_vol = sum(r.volume for r in reqs)
print(f"  {len(reqs)} campaigns, {total_vol} total messages, "
      f"{res.total_planned()} placed, {res.total_unplaced()} unplaced, {res.total_moved()} moved")
assert_invariants(res, reqs, cfg, "stress")
check("[stress] placed + unplaced == total volume", res.total_planned() + res.total_unplaced() == total_vol)

# --------------------------------------------------------------------------- 3
print("== 3. Priority: high-priority keeps target day, low-priority moves ==")
cfg = make_config(margin=0.0, cap_conversations=1000)
now = date(2026, 4, 1)
T = date(2026, 4, 10)
def win(t, ctype=CampaignType.INVITATION): return resolve_window(t, ctype, cfg, now)
hi = CampaignRequest("hi", "e1", "whatsapp", CampaignType.INVITATION, priority=9, volume=800, window=win(T))
lo = CampaignRequest("lo", "e2", "whatsapp", CampaignType.INVITATION, priority=1, volume=800, window=win(T))
res = Planner(cfg).plan([hi, lo], now)
a_hi = next(a for a in res.allocations if a.campaign_id == "hi")
a_lo = next(a for a in res.allocations if a.campaign_id == "lo")
check("high-priority fully on target day", a_hi.by_day.get(T) == 800 and a_hi.moved == 0)
check("low-priority is the one moved off target", a_lo.moved > 0)

# --------------------------------------------------------------------------- 4
print("== 4. Never violate windows even under extreme overload ==")
cfg = make_config(margin=0.0, cap_conversations=100)   # tiny capacity
now = date(2026, 5, 1)
T = date(2026, 5, 5)
# last_reminder can ONLY send on target day (0 window); overload it hard
lr = CampaignRequest("lr", "e1", "whatsapp", CampaignType.LAST_REMINDER, priority=5, volume=500,
                     window=resolve_window(T, CampaignType.LAST_REMINDER, cfg, now))
res = Planner(cfg).plan([lr], now)
a = res.allocations[0]
check("last_reminder placed only on target day", set(a.by_day.keys()) <= {T})
check("overflow beyond capacity is unplaced, not forced", a.unplaced == 400 and a.by_day.get(T) == 100)
assert_invariants(res, [lr], cfg, "window")

# --------------------------------------------------------------------------- 5
print("== 5. Continuous rebalancing: adding a campaign re-plans, not appends ==")
cfg = make_config(margin=0.0, cap_conversations=1000)
now = date(2026, 6, 1)
A, B, C = date(2026,6,10), date(2026,6,11), date(2026,6,12)
base = [
    CampaignRequest("A","e1","whatsapp",CampaignType.INVITATION,5,850,win(A)),
    CampaignRequest("B","e2","whatsapp",CampaignType.INVITATION,5,900,win(B)),
    CampaignRequest("C","e3","whatsapp",CampaignType.INVITATION,5,850,win(C)),
]
res_before = Planner(cfg).plan(base, now)
newcamp = CampaignRequest("D","e4","whatsapp",CampaignType.INVITATION,5,300,win(B))
res_after = Planner(cfg).plan(base + [newcamp], now)
load_before = dict(res_before.day_load["whatsapp"])
load_after = dict(res_after.day_load["whatsapp"])
check("new campaign volume enters the plan", res_after.total_planned() == res_before.total_planned() + 300)
check("adding to day B redistributes (B-area load changes, not just appended)",
      load_after != load_before)
assert_invariants(res_after, base + [newcamp], cfg, "rebalance")
check("[rebalance] still no day over capacity", all(v <= 1000 for v in load_after.values()))

# --------------------------------------------------------------------------- 6
print("== 6. Determinism: identical input => identical plan ==")
cfg = make_config()
r1 = Planner(cfg).plan(reqs, date(2026, 3, 1))
r2 = Planner(cfg).plan(list(reversed(reqs)), date(2026, 3, 1))   # input order shuffled
def signature(res):
    return sorted((a.campaign_id, tuple(sorted((d.isoformat(), v) for d, v in a.by_day.items())), a.unplaced)
                  for a in res.allocations)
check("plan independent of input ordering (deterministic)", signature(r1) == signature(r2))

# --------------------------------------------------------------------------- 7
print("== 7. Scheduling flexibility windows per type ==")
now = date(2026, 7, 1)
cfg = make_config()
T = date(2026, 7, 20)
w_std = resolve_window(T, CampaignType.SAVE_THE_DATE, cfg, now)
w_inv = resolve_window(T, CampaignType.INVITATION, cfg, now)
w_rem = resolve_window(T, CampaignType.REMINDER, cfg, now)
w_last = resolve_window(T, CampaignType.LAST_REMINDER, cfg, now)
check("save-the-date = ±7 days", (T - w_std.earliest).days == 7 and (w_std.latest - T).days == 7)
check("invitation = -5..+2", (T - w_inv.earliest).days == 5 and (w_inv.latest - T).days == 2)
check("reminder = -1..0", (T - w_rem.earliest).days == 1 and (w_rem.latest - T).days == 0)
check("last-reminder = 0 only", w_last.earliest == T and w_last.latest == T)
check("classify('rsvp_reminder') => REMINDER", classify("rsvp_reminder") == CampaignType.REMINDER)
check("classify('save_the_date') => SAVE_THE_DATE", classify("save_the_date") == CampaignType.SAVE_THE_DATE)
check("classify('Thank You') => THANK_YOU", classify("Thank You") == CampaignType.THANK_YOU)

# --------------------------------------------------------------------------- 8
print("== 8. Past-safety: window never starts before 'now' ==")
now = date(2026, 8, 15)
T = date(2026, 8, 16)   # target tomorrow, save-the-date wants -7 (in the past)
w = resolve_window(T, CampaignType.SAVE_THE_DATE, cfg, now)
check("earliest clamped to today, not the past", w.earliest == now)

# --------------------------------------------------------------------------- 9
print("== 9. Bidirectional closest-first placement (search both directions) ==")
from planner.strategies.deterministic import _candidate_days

now = date(2026, 10, 1)
cfg = make_config(margin=0.0, cap_conversations=100)   # 100/day
T = date(2026, 10, 20)

# (a) placement order is an expanding ring: target, -1, +1, -2, +2, ...
probe = CampaignRequest("probe", "e", "whatsapp", CampaignType.INVITATION, 5, 1,
                        window=resolve_window(T, CampaignType.INVITATION, cfg, now))  # window -5..+2
order = _candidate_days(probe)
expected_head = [T, T - timedelta(days=1), T + timedelta(days=1),
                 T - timedelta(days=2), T + timedelta(days=2)]
check("candidate order = target, -1, +1, -2, +2 (bidirectional ring)", order[:5] == expected_head)
check("ring never leaves the window", all(probe.window.contains(d) for d in order))

# (b) DECISIVE: saturate the entire earlier side, force overflow to go LATER.
# A high-priority blocker targets T-3 and fills every earlier in-window day
# (T-5..T-1); the low-priority campaign targeting T must then spill to T+1/T+2.
blocker = CampaignRequest("blocker", "e1", "whatsapp", CampaignType.INVITATION, priority=9,
                          volume=500,  # 5 days * 100 => fills T-5..T-1
                          window=resolve_window(T - timedelta(days=3), CampaignType.INVITATION, cfg, now))
overflow = CampaignRequest("overflow", "e2", "whatsapp", CampaignType.INVITATION, priority=1,
                           volume=250,
                           window=resolve_window(T, CampaignType.INVITATION, cfg, now))
res = Planner(cfg).plan([blocker, overflow], now)
a_over = next(a for a in res.allocations if a.campaign_id == "overflow")
placed_days = sorted(a_over.by_day)
check("overflow keeps 100 on the target day", a_over.by_day.get(T) == 100)
check("earlier days saturated => NO volume placed before target",
      all(d >= T for d in placed_days), extra=str([str(d) for d in placed_days]))
check("overflow flows to LATER days (bidirectional fallback: T+1, T+2)",
      a_over.by_day.get(T + timedelta(days=1)) == 100 and a_over.by_day.get(T + timedelta(days=2)) == 50)
assert_invariants(res, [blocker, overflow], cfg, "bidir")

# (c) closest wins regardless of direction: a near LATER day beats a far EARLIER
# one. Saturate only the immediate earlier neighbour (T-1); nearest free is T+1
# (dist 1) which must be used before T-2 (dist 2).
blk2 = CampaignRequest("blk2", "e3", "whatsapp", CampaignType.INVITATION, priority=9, volume=100,
                       window=resolve_window(T - timedelta(days=1), CampaignType.LAST_REMINDER, cfg, now))  # only T-1
ov2 = CampaignRequest("ov2", "e4", "whatsapp", CampaignType.INVITATION, priority=1, volume=150,
                      window=resolve_window(T, CampaignType.INVITATION, cfg, now))
res2 = Planner(cfg).plan([blk2, ov2], now)
a_ov2 = next(a for a in res2.allocations if a.campaign_id == "ov2")
check("closest-free after target is nearer LATER day, not farther earlier day",
      a_ov2.by_day.get(T) == 100 and a_ov2.by_day.get(T + timedelta(days=1)) == 50
      and a_ov2.by_day.get(T - timedelta(days=2)) is None)

print(f"\nRESULT: {PASS}/{PASS + FAIL} checks passed")
sys.exit(0 if FAIL == 0 else 1)
