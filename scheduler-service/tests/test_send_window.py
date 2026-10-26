"""Standalone test for the campaign send window (stdlib + tzdata only).

    cd scheduler-service && python3 tests/test_send_window.py
"""
import os
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from send_window import (  # noqa: E402
    is_within_send_window, parse_window, next_window_open, DEFAULT_SEND_WINDOW,
)

IL = ZoneInfo("Asia/Jerusalem")
FAIL = 0


def check(name, cond):
    global FAIL
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")
    FAIL += (not cond)


def il(y, m, d, hh, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=IL).astimezone(timezone.utc)


# 2026-10-04 is a Sunday; 2026-10-09 Friday; 2026-10-10 Saturday.
S = DEFAULT_SEND_WINDOW
check("Sun 08:59 closed", not is_within_send_window(il(2026, 10, 4, 8, 59), S))
check("Sun 09:00 open", is_within_send_window(il(2026, 10, 4, 9, 0), S))
check("Wed 20:59 open", is_within_send_window(il(2026, 10, 7, 20, 59), S))
check("Wed 21:00 closed", not is_within_send_window(il(2026, 10, 7, 21, 0), S))
check("Thu 23:30 closed", not is_within_send_window(il(2026, 10, 8, 23, 30), S))
check("Fri 13:59 open", is_within_send_window(il(2026, 10, 9, 13, 59), S))
check("Fri 14:00 closed (Shabbat)", not is_within_send_window(il(2026, 10, 9, 14, 0), S))
check("Sat 12:00 closed (Shabbat)", not is_within_send_window(il(2026, 10, 10, 12, 0), S))
check("Sat 19:59 closed", not is_within_send_window(il(2026, 10, 10, 19, 59), S))
check("Sat 20:00 open", is_within_send_window(il(2026, 10, 10, 20, 0), S))
check("Sat 21:00 closed", not is_within_send_window(il(2026, 10, 10, 21, 0), S))
# DST: Israel winter time (UTC+2) - 2026-12-06 Sunday 09:00 local == 07:00 UTC
check("winter: Sun 07:00 UTC == 09:00 IL open",
      is_within_send_window(datetime(2026, 12, 6, 7, 0, tzinfo=timezone.utc), S))
check("winter: Sun 06:59 UTC closed",
      not is_within_send_window(datetime(2026, 12, 6, 6, 59, tzinfo=timezone.utc), S))
# Disabled
check("SEND_WINDOW=off always open", is_within_send_window(il(2026, 10, 10, 3, 0), "off"))
check("parse off -> None", parse_window("off") is None)
# Invalid spec falls back to the default (never silently disables quiet hours)
check("invalid spec falls back to default", not is_within_send_window(il(2026, 10, 10, 12, 0), "garbage"))
# Custom spec with multiple ranges
spec = "sun-thu=08:00-12:00,13:00-22:00;fri,sat=10:00-11:00"
check("custom: Mon 12:30 closed", not is_within_send_window(il(2026, 10, 5, 12, 30), spec))
check("custom: Mon 21:30 open", is_within_send_window(il(2026, 10, 5, 21, 30), spec))
check("custom: Sat 10:30 open", is_within_send_window(il(2026, 10, 10, 10, 30), spec))
# next open
nxt = next_window_open(il(2026, 10, 9, 15, 0), S)
check(f"next open after Fri 15:00 is Sat 20:00 (got {nxt})",
      nxt is not None and nxt.weekday() == 5 and (nxt.hour, nxt.minute) == (20, 0))

print("FAILED" if FAIL else "ALL PASSED")
sys.exit(1 if FAIL else 0)
