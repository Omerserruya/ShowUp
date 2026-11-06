"""Default round plan for an event: which message rounds and phone-call rounds it
gets, and when - computed on the SERVER so every event has its rounds the moment
it exists, however it was created (wizard, gift link, admin, venue).

Message rounds are a port of the wizard's adaptive timeline
(frontend/src/config/scheduling.ts - keep the two in step): per event-type ideal
offsets, filtered by plan tier, compressed toward the event when time is short,
never in the past, capped at the plan's included rounds.

Phone rounds (voice-service) sit BETWEEN the WhatsApp rounds: a call only makes
sense once guests had a chance to answer in WhatsApp, so each call round is
placed after the first pre-event message round, spaced out, inside the legal
call window (10:00-20:00, Friday until 13:00, never Saturday), and never on the
event day itself. Plus gets 1, Pro gets 3 (voice_calls.included_call_rounds).

Pure functions only - callers persist the result.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta
from typing import Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from .rounds import included_rounds
from .voice_calls import CALL_HOURS, FRIDAY_LAST_HOUR, included_call_rounds

IL = ZoneInfo("Asia/Jerusalem")

BUFFER_HOURS = 3          # never schedule within this many hours of "now"
MIN_GAP_HOURS = 12        # consecutive message rounds at least this far apart
PLAN_TIER = {"free": 0, "basic": 0, "plus": 1, "pro": 2}


@dataclass(frozen=True)
class Spec:
    stage: str
    title: str
    preferred: int        # ideal days before the event (negative = after)
    minimum: int          # closest-to-event offset still accepted
    priority: int         # lower = more important
    optional: bool
    at: str               # 'HH:MM' Israel time
    min_tier: int


def _s(stage, title, pref, mn, prio, opt, at, tier) -> Spec:
    return Spec(stage, title, pref, mn, prio, opt, at, tier)


_SCHEDULES: Dict[str, Tuple[Spec, ...]] = {
    "wedding": (
        _s("invitation", "אישור הגעה ראשוני", 30, 3, 2, False, "10:00", 1),
        _s("reminder", "אישור הגעה נוסף", 7, 1, 2, False, "12:00", 0),
        _s("final_reminder", "תזכורת לאירוע", 1, 0, 1, False, "18:00", 0),
        _s("thank_you", "תודה אחרי האירוע", -1, -1, 3, True, "11:00", 1),
    ),
    "mitzvah": (
        _s("invitation", "אישור הגעה ראשוני", 21, 3, 2, False, "10:00", 1),
        _s("reminder", "אישור הגעה נוסף", 7, 1, 2, False, "12:00", 0),
        _s("final_reminder", "תזכורת לאירוע", 1, 0, 1, False, "18:00", 0),
        _s("thank_you", "תודה אחרי האירוע", -1, -1, 3, True, "11:00", 1),
    ),
    "brit": (
        _s("invitation", "אישור הגעה ראשוני", 5, 0, 1, False, "10:00", 0),
        _s("reminder", "אישור הגעה נוסף", 3, 1, 4, True, "10:00", 0),
        _s("final_reminder", "תזכורת לאירוע", 1, 0, 2, False, "09:00", 0),
        _s("thank_you", "תודה אחרי האירוע", -1, -1, 3, True, "11:00", 1),
    ),
    "business": (
        _s("invitation", "אישור הגעה ראשוני", 14, 1, 2, False, "09:00", 1),
        _s("reminder", "אישור הגעה נוסף", 3, 1, 2, False, "09:00", 0),
        _s("final_reminder", "תזכורת לאירוע", 1, 0, 1, False, "09:00", 0),
        _s("thank_you", "תודה אחרי האירוע", -1, -1, 3, True, "12:00", 1),
    ),
    "social": (
        _s("invitation", "אישור הגעה ראשוני", 14, 2, 2, False, "11:00", 1),
        _s("reminder", "אישור הגעה נוסף", 5, 1, 2, False, "12:00", 0),
        _s("final_reminder", "תזכורת לאירוע", 1, 0, 1, False, "18:00", 0),
        _s("thank_you", "תודה אחרי האירוע", -1, -1, 3, True, "11:00", 1),
    ),
}

_SCHEDULE_KEY = {"wedding": "wedding", "brit": "brit", "brita": "brit", "bar": "mitzvah", "bat": "mitzvah",
                 "corporate": "business", "birthday": "social"}


@dataclass(frozen=True)
class PlannedRound:
    stage: str
    title: str
    at: datetime          # aware, UTC
    enabled: bool = True
    adjusted: bool = False   # moved from its ideal time to fit


def _local(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=IL)
    return value.astimezone(IL)


def _at(day: datetime, hhmm: str) -> datetime:
    h, m = (int(x) for x in hhmm.split(":"))
    return datetime.combine(day.date(), time(h, m), tzinfo=IL)


# ---- anchored stages ---------------------------------------------------------------
# Two rounds are tied to the event itself, not to a "days before" offset:
#   * the event reminder (final_reminder): the day before, with navigation (and
#     the gift link) - for guests who confirmed. The approved catalog copy says
#     "מחר", so it is never moved onto the event day.
#   * the thank-you: an evening event -> the next morning at 10:00; a morning /
#     afternoon event -> the same evening at 20:30.
# Both are then fitted to the WhatsApp send window (Friday until 14:00, Saturday
# only 20:00-21:00): the reminder moves EARLIER on the same day (it must arrive
# before the event), the thank-you moves LATER (scheduler-service SEND_WINDOW).
EVENING_FROM = time(16, 0)
THANK_YOU_MORNING = "10:00"
THANK_YOU_SAME_EVENING = "20:30"
_FRI, _SAT = 4, 5


def _fit_earlier(t: datetime) -> datetime:
    if t.weekday() == _FRI and t.time() >= time(14, 0):
        return t.replace(hour=12, minute=0)
    if t.weekday() == _SAT and not (time(20, 0) <= t.time() < time(21, 0)):
        return t.replace(hour=20, minute=0)
    return t


def _fit_later(t: datetime) -> datetime:
    if (t.weekday() == _FRI and t.time() >= time(14, 0)) or (t.weekday() == _SAT and t.time() < time(20, 0)):
        sat = t if t.weekday() == _SAT else t + timedelta(days=1)
        return sat.replace(hour=20, minute=0)
    if t.weekday() == _SAT and t.time() >= time(21, 0):
        return _at(t + timedelta(days=1), THANK_YOU_MORNING)
    return t


def event_reminder_time(event_date: datetime, at: str = "18:00") -> datetime:
    """Israel-local send time of the event reminder (the day before)."""
    ev = _local(event_date)
    return _fit_earlier(_at(ev - timedelta(days=1), at))


def thank_you_time(event_date: datetime) -> datetime:
    """Israel-local send time of the thank-you (see the rules above)."""
    ev = _local(event_date)
    if ev.time() >= EVENING_FROM:
        t = _at(ev + timedelta(days=1), THANK_YOU_MORNING)
    else:
        t = _at(ev, THANK_YOU_SAME_EVENING)
    return _fit_later(t)


def replan_time(stage: Optional[str], send_at: datetime, old_event: datetime, new_event: datetime) -> datetime:
    """Where a not-yet-sent round goes when the event moves. Anchored stages are
    recomputed from their rules; every other round moves by whole days and keeps
    its time of day, so changing only the event's HOUR never drags a round into
    the night (it used to: 11:46 -> 19:30 moved a 09:00 round to 16:44)."""
    if stage == "thank_you":
        return thank_you_time(new_event).astimezone(ZoneInfo("UTC"))
    if stage == "final_reminder":
        # Keeps the hour the owner picked, unless it was a night hour.
        hhmm = _local(send_at).strftime("%H:%M")
        if not ("09:00" <= hhmm <= "21:00"):
            hhmm = "18:00"
        return event_reminder_time(new_event, hhmm).astimezone(ZoneInfo("UTC"))
    days = (_local(new_event).date() - _local(old_event).date()).days
    return (_local(send_at) + timedelta(days=days)).astimezone(ZoneInfo("UTC"))


def message_rounds(event_type: Optional[str], plan_id: Optional[str], event_date: Optional[datetime],
                   now: datetime) -> List[PlannedRound]:
    """The message rounds an event gets by default (enabled ones only are
    created). Empty when the event has no date yet."""
    if event_date is None:
        return []
    tier = PLAN_TIER.get((plan_id or "").lower(), 0)
    specs = [s for s in _SCHEDULES[_SCHEDULE_KEY.get((event_type or "").lower(), "wedding")] if s.min_tier <= tier]
    ev = _local(event_date)
    now_l = _local(now)
    earliest = now_l + timedelta(hours=BUFFER_HOURS)
    out: List[Tuple[Spec, PlannedRound]] = []
    prev: Optional[datetime] = None
    for s in sorted((s for s in specs if s.preferred >= 0), key=lambda s: -s.preferred):
        ideal = (event_reminder_time(ev, s.at) if s.stage == "final_reminder"
                 else _at(ev - timedelta(days=s.preferred), s.at))
        cap = min(_at(ev - timedelta(days=s.minimum), s.at), ev)
        lower = max(earliest, prev + timedelta(hours=MIN_GAP_HOURS)) if prev else earliest
        if lower > cap:
            if s.optional or cap < earliest:
                continue
            send = cap
        else:
            send = min(max(ideal, lower), cap)
        out.append((s, PlannedRound(s.stage, s.title, send.astimezone(ZoneInfo("UTC")), True, send != ideal)))
        prev = send
    for s in (s for s in specs if s.preferred < 0):
        send = max(thank_you_time(ev) if s.stage == "thank_you"
                   else _at(ev - timedelta(days=s.preferred), s.at), earliest)
        out.append((s, PlannedRound(s.stage, s.title, send.astimezone(ZoneInfo("UTC")),
                                    s.stage != "thank_you" or tier >= 2)))
    # cap at the plan's included rounds, dropping the least important first
    cap_n = included_rounds(plan_id)
    enabled = [(s, r) for s, r in out if r.enabled]
    if len(enabled) > cap_n:
        drop = {id(r) for s, r in sorted(enabled, key=lambda x: -x[0].priority)[:len(enabled) - cap_n]}
        out = [(s, r if id(r) not in drop else PlannedRound(r.stage, r.title, r.at, False, r.adjusted)) for s, r in out]
    return sorted((r for _s2, r in out), key=lambda r: r.at)


# ---- phone-call rounds ------------------------------------------------------------

CALL_AT = "11:00"
# Ideal days-before for each call round, by how many the plan includes.
CALL_OFFSETS = {1: (4,), 2: (6, 2), 3: (10, 5, 2)}
CALL_AFTER_FIRST_MESSAGE_H = 48   # give guests two days to answer in WhatsApp first
CALL_MIN_GAP_H = 48               # between call rounds
CALL_MIN_DAYS_BEFORE = 1          # never on the event day


def _callable_day(dt: datetime) -> datetime:
    """Move a time onto the next moment calls are allowed (forward only)."""
    start, end = CALL_HOURS
    for _ in range(8):
        wd = dt.weekday()
        last = FRIDAY_LAST_HOUR if wd == 4 else end
        if wd == 5 or dt.hour >= last:
            dt = datetime.combine((dt + timedelta(days=1)).date(), time(start), tzinfo=IL)
            continue
        if dt.hour < start:
            dt = dt.replace(hour=start, minute=0)
        return dt
    return dt


def call_rounds(event_type: Optional[str], plan_id: Optional[str], event_date: Optional[datetime],
                now: datetime, *, rounds: Optional[int] = None) -> List[datetime]:
    """Start times (aware, UTC) for the event's automatic phone rounds. A round
    that cannot fit (event too close, nothing sent yet) is dropped, never
    squeezed onto the event day."""
    n = included_call_rounds(plan_id) if rounds is None else rounds
    if not n or event_date is None:
        return []
    ev = _local(event_date)
    now_l = _local(now)
    msgs = [r for r in message_rounds(event_type, plan_id, event_date, now) if r.enabled and _local(r.at) < ev]
    first_msg = _local(msgs[0].at) if msgs else now_l
    lower = max(now_l + timedelta(hours=BUFFER_HOURS), first_msg + timedelta(hours=CALL_AFTER_FIRST_MESSAGE_H))
    last_ok = datetime.combine((ev - timedelta(days=CALL_MIN_DAYS_BEFORE)).date(), time(CALL_HOURS[1] - 1), tzinfo=IL)
    offsets = CALL_OFFSETS.get(min(n, 3), CALL_OFFSETS[3])
    out: List[datetime] = []
    for days in offsets:
        ideal = _at(ev - timedelta(days=days), CALL_AT)
        at = _callable_day(max(ideal, lower))
        if at > last_ok:
            continue
        out.append(at)
        lower = at + timedelta(hours=CALL_MIN_GAP_H)
    return [a.astimezone(ZoneInfo("UTC")) for a in out]
