"""Release-timing test: planner batches release at the campaign's LOCAL send
time on their release day (Asia/Jerusalem), never at 00:00 UTC.

    cd planner-service && python3 tests/test_release_instant.py   (needs psycopg2)
"""
import os
import sys
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import runtime
except ImportError as exc:  # psycopg2 missing locally
    print(f"SKIP: {exc}")
    sys.exit(0)

FAIL = 0


def check(name, cond):
    global FAIL
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")
    FAIL += (not cond)


# Summer (UTC+3): owner scheduled 19:30 IL on 2026-10-06 == 16:30 UTC.
sched = datetime(2026, 10, 6, 16, 30, tzinfo=timezone.utc)
r = runtime.release_instant(date(2026, 10, 5), sched)
check(f"moved-earlier batch keeps 19:30 local (got {r})", r == datetime(2026, 10, 5, 16, 30, tzinfo=timezone.utc))
# Winter (UTC+2): same local 19:30 on 2026-12-01 == 17:30 UTC
r = runtime.release_instant(date(2026, 12, 1), sched)
check(f"DST-correct in winter (got {r})", r == datetime(2026, 12, 1, 17, 30, tzinfo=timezone.utc))
# Late-evening UTC that is next day locally: 22:30 UTC on 10-06 == 01:30 IL 10-07
check("local date of schedule_time", runtime._as_date(datetime(2026, 10, 6, 22, 30, tzinfo=timezone.utc))
      == date(2026, 10, 7))
# No schedule time -> 09:00 local
r = runtime.release_instant(date(2026, 10, 5), None)
check(f"default 09:00 local (got {r})", r == datetime(2026, 10, 5, 6, 0, tzinfo=timezone.utc))

print("FAILED" if FAIL else "ALL PASSED")
sys.exit(1 if FAIL else 0)
