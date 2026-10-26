"""Campaign sending window (quiet hours + Shabbat).

Campaign rounds are only STARTED inside the window; a campaign that falls due
outside it simply waits - the scheduler does not release it until the window
opens. Interactive / owner-facing traffic (bot replies, assistant, owner
notifications, daily summary) is never restricted.

Spec (env SEND_WINDOW), evaluated in SEND_WINDOW_TZ (default Asia/Jerusalem):

    "<days>=<HH:MM>-<HH:MM>[,<HH:MM>-<HH:MM>...];<days>=..."
    days: sun mon tue wed thu fri sat, a range "sun-thu", or a list "fri,sat"

Default: Sun-Thu 09:00-21:00, Friday 09:00-14:00, Saturday 20:00-21:00 - i.e.
nothing from Friday 14:00 until Saturday 20:00, and only 09:00-21:00 otherwise.
SEND_WINDOW=off (or "always") disables the restriction.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

try:
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None  # type: ignore

DEFAULT_SEND_WINDOW = "sun-thu=09:00-21:00;fri=09:00-14:00;sat=20:00-21:00"
DEFAULT_TZ = "Asia/Jerusalem"

# Python weekday(): Monday=0 ... Sunday=6
_DAYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}
# Israeli week order for ranges like "sun-thu".
_WEEK_ORDER = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

Window = Dict[int, List[Tuple[int, int]]]  # weekday -> [(start_min, end_min)]


def _parse_hhmm(s: str) -> int:
    h, m = s.strip().split(":")
    v = int(h) * 60 + int(m)
    if not 0 <= v <= 24 * 60:
        raise ValueError(f"bad time {s!r}")
    return v


def _parse_days(s: str) -> List[int]:
    out: List[int] = []
    for part in s.split(","):
        part = part.strip().lower()
        if not part:
            continue
        if "-" in part:
            a, b = (x.strip()[:3] for x in part.split("-", 1))
            ia, ib = _WEEK_ORDER.index(a), _WEEK_ORDER.index(b)
            names = _WEEK_ORDER[ia:ib + 1] if ia <= ib else _WEEK_ORDER[ia:] + _WEEK_ORDER[:ib + 1]
            out.extend(_DAYS[n] for n in names)
        else:
            out.append(_DAYS[part[:3]])
    return out


def parse_window(spec: str) -> Optional[Window]:
    """Parse a spec. Returns None when the window is disabled."""
    spec = (spec or "").strip()
    if spec.lower() in ("off", "none", "always", "disabled", "0", "false"):
        return None
    window: Window = {d: [] for d in range(7)}
    for clause in spec.split(";"):
        clause = clause.strip()
        if not clause:
            continue
        days_s, ranges_s = clause.split("=", 1)
        days = _parse_days(days_s)
        for r in ranges_s.split(","):
            r = r.strip()
            if not r:
                continue
            a, b = r.split("-", 1)
            start, end = _parse_hhmm(a), _parse_hhmm(b)
            if end <= start:
                raise ValueError(f"empty/inverted range {r!r}")
            for d in days:
                window[d].append((start, end))
    return window


def _tz(name: Optional[str] = None):
    name = name or os.getenv("SEND_WINDOW_TZ", DEFAULT_TZ)
    if ZoneInfo is not None:
        try:
            return ZoneInfo(name)
        except Exception:
            pass
    # Fallback without tzdata: Israel standard time (DST-unaware, errs early by 1h in summer).
    return timezone(timedelta(hours=2))


_cached: Dict[str, Optional[Window]] = {}


def current_window(spec: Optional[str] = None) -> Optional[Window]:
    spec = spec if spec is not None else os.getenv("SEND_WINDOW", DEFAULT_SEND_WINDOW)
    if spec not in _cached:
        try:
            _cached[spec] = parse_window(spec)
        except Exception:
            # A typo must not silently disable quiet hours: fall back to default.
            _cached[spec] = parse_window(DEFAULT_SEND_WINDOW)
    return _cached[spec]


def is_within_send_window(now: Optional[datetime] = None, spec: Optional[str] = None,
                          tz_name: Optional[str] = None) -> bool:
    """True when a campaign may START sending at `now` (aware; default: now UTC)."""
    window = current_window(spec)
    if window is None:
        return True
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    local = now.astimezone(_tz(tz_name))
    minute = local.hour * 60 + local.minute
    return any(start <= minute < end for start, end in window.get(local.weekday(), []))


def next_window_open(now: Optional[datetime] = None, spec: Optional[str] = None,
                     tz_name: Optional[str] = None) -> Optional[datetime]:
    """When the window next opens (for logs). None if disabled / never."""
    window = current_window(spec)
    if window is None:
        return None
    now = now or datetime.now(timezone.utc)
    tz = _tz(tz_name)
    local = now.astimezone(tz).replace(second=0, microsecond=0)
    for step in range(0, 8 * 24 * 60):
        t = local + timedelta(minutes=step)
        minute = t.hour * 60 + t.minute
        if any(s <= minute < e for s, e in window.get(t.weekday(), [])):
            return t
    return None


# --------------------------------------------------------------------------
# Planner helpers (planner-service only). This file is a copy of
# scheduler-service/send_window.py - keep the parser in sync; the scheduler's
# copy is what actually gates release, the planner uses it to put release_at
# INSIDE an open window and to skip days that cannot send.
# --------------------------------------------------------------------------
from datetime import date as _date  # noqa: E402


def day_ranges(day: _date, spec: Optional[str] = None) -> Optional[List[Tuple[int, int]]]:
    """Open (start_min, end_min) ranges on a local calendar day, sorted.
    None = window disabled (always open)."""
    window = current_window(spec)
    if window is None:
        return None
    return sorted(window.get(day.weekday(), []))


def adjust_minute_into_window(day: _date, minute: int, spec: Optional[str] = None) -> int:
    """Local minute-of-day to release at on `day` so it falls inside an open
    range: kept when already inside; else the start of the next range later
    that day; else (after every range closed) the day's first range start.
    Unchanged when the window is disabled or the day has no range at all."""
    ranges = day_ranges(day, spec)
    if not ranges:
        return minute
    for start, end in ranges:
        if start <= minute < end:
            return minute
    for start, _end in ranges:
        if start > minute:
            return start
    return ranges[0][0]


def day_is_sendable(day: _date, now_local_minute: Optional[int] = None,
                    spec: Optional[str] = None) -> bool:
    """False when nothing can be released on `day`: no open range at all, or -
    when `now_local_minute` is given (i.e. `day` is today) - every range has
    already closed. Used so a 'send now' at 22:00 / Friday 15:00 is planned on
    the next open day instead of counted as today's volume."""
    ranges = day_ranges(day, spec)
    if ranges is None:
        return True
    if not ranges:
        return False
    if now_local_minute is None:
        return True
    return any(end > now_local_minute for _s, end in ranges)
