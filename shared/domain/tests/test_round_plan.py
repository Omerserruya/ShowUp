from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from shared.domain import round_plan as rp

IL = ZoneInfo("Asia/Jerusalem")
NOW = datetime(2026, 9, 1, 9, 0, tzinfo=IL)          # Tuesday
WEDDING = datetime(2026, 11, 12, 19, 30, tzinfo=IL)    # Thursday, ~10 weeks out


def local(dt):
    return dt.astimezone(IL)


def test_message_rounds_follow_the_wizard_offsets_and_plan_cap():
    pro = rp.message_rounds("wedding", "pro", WEDDING, NOW)
    assert [(r.stage, r.enabled) for r in pro] == [
        ("invitation", True), ("reminder", True), ("final_reminder", True), ("thank_you", True)]
    assert local(pro[0].at) == datetime(2026, 10, 13, 10, 0, tzinfo=IL)   # 30 days before, 10:00
    assert local(pro[2].at) == datetime(2026, 11, 11, 18, 0, tzinfo=IL)
    plus = rp.message_rounds("wedding", "plus", WEDDING, NOW)
    assert [r.stage for r in plus if r.enabled] == ["invitation", "reminder", "final_reminder"]  # thank-you off
    basic = rp.message_rounds("wedding", "basic", WEDDING, NOW)
    assert [r.stage for r in basic] == ["reminder", "final_reminder"]
    assert rp.message_rounds("wedding", "pro", None, NOW) == []


def test_message_rounds_compress_when_the_event_is_close():
    soon = NOW + timedelta(days=4)
    rounds = [r for r in rp.message_rounds("wedding", "pro", soon, NOW) if r.enabled]
    assert all(local(r.at) >= NOW + timedelta(hours=rp.BUFFER_HOURS) for r in rounds)
    times = [r.at for r in rounds]
    assert times == sorted(times) and rounds[0].adjusted


def test_call_rounds_sit_after_whatsapp_inside_the_call_window():
    pro = [local(t) for t in rp.call_rounds("wedding", "pro", WEDDING, NOW)]
    assert [t.date().isoformat() for t in pro] == ["2026-11-02", "2026-11-08", "2026-11-10"]
    assert all(10 <= t.hour < 20 and t.weekday() != 5 for t in pro)
    assert [local(t).date().isoformat() for t in rp.call_rounds("wedding", "plus", WEDDING, NOW)] == ["2026-11-08"]
    assert rp.call_rounds("wedding", "basic", WEDDING, NOW) == []
    assert rp.call_rounds("wedding", "pro", None, NOW) == []


def test_saturday_and_friday_afternoon_move_forward():
    sat_noon = datetime(2026, 11, 7, 11, 0, tzinfo=IL)
    assert rp._callable_day(sat_noon) == datetime(2026, 11, 8, 10, 0, tzinfo=IL)
    fri_late = datetime(2026, 11, 6, 15, 0, tzinfo=IL)
    assert rp._callable_day(fri_late) == datetime(2026, 11, 8, 10, 0, tzinfo=IL)


def test_short_notice_drops_calls_that_cannot_fit_and_never_calls_on_the_day():
    brit = NOW + timedelta(days=3)
    calls = [local(t) for t in rp.call_rounds("brit", "pro", brit, NOW)]
    assert all(t.date() < brit.date() for t in calls)
    assert len(calls) <= 1
    first_msg = min(local(r.at) for r in rp.message_rounds("brit", "pro", brit, NOW) if r.enabled)
    assert all(t >= first_msg + timedelta(hours=rp.CALL_AFTER_FIRST_MESSAGE_H) for t in calls)


def test_event_reminder_is_the_day_before_inside_the_send_window():
    assert rp.event_reminder_time(WEDDING) == datetime(2026, 11, 11, 18, 0, tzinfo=IL)       # Wed 18:00
    sat_night = datetime(2026, 11, 14, 20, 30, tzinfo=IL)
    assert rp.event_reminder_time(sat_night) == datetime(2026, 11, 13, 12, 0, tzinfo=IL)    # Friday -> 12:00
    sunday = datetime(2026, 11, 15, 11, 0, tzinfo=IL)
    assert rp.event_reminder_time(sunday) == datetime(2026, 11, 14, 20, 0, tzinfo=IL)       # Saturday -> 20:00


def test_thank_you_next_morning_or_same_evening():
    assert rp.thank_you_time(WEDDING) == datetime(2026, 11, 13, 10, 0, tzinfo=IL)           # evening -> 10:00 next day
    noon = datetime(2026, 11, 10, 12, 0, tzinfo=IL)
    assert rp.thank_you_time(noon) == datetime(2026, 11, 10, 20, 30, tzinfo=IL)             # noon -> 20:30 same day
    fri_morning = datetime(2026, 11, 13, 10, 0, tzinfo=IL)
    assert rp.thank_you_time(fri_morning) == datetime(2026, 11, 14, 20, 0, tzinfo=IL)       # Fri eve -> Sat 20:00
    fri_night = datetime(2026, 11, 13, 20, 0, tzinfo=IL)
    assert rp.thank_you_time(fri_night) == datetime(2026, 11, 14, 20, 0, tzinfo=IL)         # Sat morning -> Sat 20:00
    pro = rp.message_rounds("wedding", "pro", WEDDING, NOW)
    assert local(pro[-1].at) == datetime(2026, 11, 13, 10, 0, tzinfo=IL)


def test_changing_only_the_hour_keeps_the_rounds_in_place():
    old = datetime(2026, 11, 3, 11, 46, tzinfo=IL)
    new = datetime(2026, 11, 3, 19, 30, tzinfo=IL)
    reminder = datetime(2026, 10, 27, 12, 0, tzinfo=IL)
    assert local(rp.replan_time("reminder", reminder, old, new)) == reminder
    assert local(rp.replan_time("final_reminder", datetime(2026, 11, 2, 18, 0, tzinfo=IL), old, new)) == \
        datetime(2026, 11, 2, 18, 0, tzinfo=IL)
    assert local(rp.replan_time("final_reminder", datetime(2026, 11, 3, 1, 44, tzinfo=IL), old, new)) == \
        datetime(2026, 11, 2, 18, 0, tzinfo=IL)                                              # night hour -> 18:00
    assert local(rp.replan_time("thank_you", datetime(2026, 11, 4, 18, 44, tzinfo=IL), old, new)) == \
        datetime(2026, 11, 4, 10, 0, tzinfo=IL)
    later = datetime(2026, 11, 10, 19, 30, tzinfo=IL)                                         # a week later
    assert local(rp.replan_time("reminder", reminder, old, later)) == datetime(2026, 11, 3, 12, 0, tzinfo=IL)
