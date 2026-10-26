"""AI assistant improvements (2026-10 live test): CreateCampaign behind the
server-side confirmation gate, the rounds-exhausted message, party_size
mapping, QuestionResults, and the product-knowledge prompt. OpenAI is mocked.
"""
from __future__ import annotations

import datetime as dt
import json
import uuid

from app.ai_tools import ToolContext, ToolError, dispatch_tool
from tests.conftest import auth_header, make_event as _make_event
from tests.test_launch_blockers_2026_10 import _fake_openai, _last_tool_result


def _event(db, owner, *, allowance=10, days_ahead=30, event_type=None):
    from app.models.models import Event
    eid = _make_event(db, owner)
    ev = db.query(Event).filter(Event.id == eid).first()
    ev.extra_rounds_allowance = allowance
    ev.event_date = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=days_ahead)
    if event_type:
        ev.event_type = event_type
    db.commit()
    return eid


def _guest(db, event_id, name, phone, status="invited", **kw):
    from app.models.models import Guest
    g = Guest(event_id=str(event_id), name=name, phone=phone, status=status,
              import_count=kw.pop("import_count", 1), **kw)
    db.add(g)
    db.commit()
    db.refresh(g)
    return g.id


def _ctx(db, owner, event_id):
    return ToolContext(db=db, user_id=owner, event_id=event_id)


def _future_il(days=3, hour=12):
    d = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=days)).date()
    return f"{d.isoformat()}T{hour:02d}:00:00+02:00"


# ------------------------------------------------------------ CreateCampaign

def test_create_campaign_needs_confirmation_then_schedules(client, db, monkeypatch):
    from app.models.models import Campaign
    owner = uuid.uuid4()
    event_id = _event(db, owner)
    _guest(db, event_id, "זהר", "+972500000001")
    _guest(db, event_id, "דנה", "+972500000002", status="confirmed")
    when = _future_il()
    seen = {}

    def t1_call(messages):
        return None, [("CreateCampaign", {"stage": "reminder", "when": when})]

    def t1_reply(messages):
        seen["t1"] = _last_tool_result(messages)
        return "ליצור תזכורת? תענו כן", []

    _fake_openai(monkeypatch, [t1_call, t1_reply])
    r = client.post("/assistant", json={"message": "תשלחי תזכורת למי שלא ענה ביום חמישי",
                                        "event_id": str(event_id)}, headers=auth_header(owner))
    assert r.status_code == 200, r.text
    t1 = json.loads(seen["t1"])
    assert t1["needs_confirmation"] is True
    assert "תזכורת" in t1["summary"] and "1 אורחים" in t1["summary"]
    db.expire_all()
    assert db.query(Campaign).filter(Campaign.event_id == str(event_id)).count() == 0

    def t2_call(messages):
        return None, [("ConfirmAction", {})]

    def t2_reply(messages):
        seen["t2"] = _last_tool_result(messages)
        return "תוזמן!", []

    _fake_openai(monkeypatch, [t2_call, t2_reply])
    r = client.post("/assistant", json={"message": "כן", "event_id": str(event_id)},
                    headers=auth_header(owner))
    assert r.status_code == 200, r.text
    t2 = json.loads(seen["t2"])
    assert t2["confirmed_action"] == "CreateCampaign"
    data = t2["untrusted_data"]
    assert data["template"] == "reminder"          # catalog default sendable for the stage
    assert data["audience"] == "no_response"       # stage-derived audience
    assert data["planned_recipients"] == 1
    assert "NOT been sent" in data["note"]
    db.expire_all()
    camps = db.query(Campaign).filter(Campaign.event_id == str(event_id)).all()
    assert len(camps) == 1 and camps[0].status == "pending"
    expected = dt.datetime.fromisoformat(when)
    assert abs((camps[0].schedule_time - expected).total_seconds()) < 2

    # The round was consumed from the usage ledger, exactly like the UI path.
    from app.usage import event_usage_total
    from shared.domain.enums import UsageMetric
    assert event_usage_total(db, event_id, UsageMetric.ROUND_LAUNCHED) == 1


def test_create_campaign_audience_override_and_event_type_template(db):
    owner = uuid.uuid4()
    event_id = _event(db, owner, event_type="bar")
    _guest(db, event_id, "א", "+972500000011", status="confirmed")
    from app import assistant_guard as guard
    summary = guard.confirmation_summary(_ctx(db, owner, event_id), "CreateCampaign",
                                         {"stage": "final_reminder", "when": _future_il(),
                                          "audience": "confirmed"})
    assert "תזכורת אחרונה" in summary and "מי שאישר הגעה" in summary
    res = dispatch_tool(_ctx(db, owner, event_id), "CreateCampaign",
                        {"stage": "final_reminder", "when": _future_il(), "audience": "confirmed"})
    assert res["result"]["template"] == "event_remind"
    assert res["result"]["audience"] == "confirmed"


def test_create_campaign_rounds_exhausted_is_hebrew_and_not_parked(client, db, monkeypatch):
    from app.models.models import Campaign
    owner = uuid.uuid4()
    event_id = _event(db, owner, allowance=0)   # no plan, nothing purchased -> 0 rounds
    _guest(db, event_id, "זהר", "+972500000001")
    seen = {}

    def call(messages):
        return None, [("CreateCampaign", {"stage": "reminder", "when": _future_il()})]

    def reply(messages):
        seen["r"] = _last_tool_result(messages)
        return "נגמרו הסבבים", []

    _fake_openai(monkeypatch, [call, reply])
    r = client.post("/assistant", json={"message": "תשלחי תזכורת", "event_id": str(event_id)},
                    headers=auth_header(owner))
    assert r.status_code == 200, r.text
    err = seen["r"]
    assert err.startswith("Error: ROUNDS_EXHAUSTED")
    assert "בתשלום" in err and "סבבי שליחה" in err and "סבב חדש" in err
    db.expire_all()
    assert db.query(Campaign).filter(Campaign.event_id == str(event_id)).count() == 0
    from sqlalchemy import text
    parked = db.execute(text("SELECT count(*) FROM assistant_pending_actions WHERE event_id = :e"),
                        {"e": str(event_id)}).scalar()
    assert parked == 0


def test_create_campaign_validation_errors(db):
    owner = uuid.uuid4()
    event_id = _event(db, owner, days_ahead=2)
    ctx = _ctx(db, owner, event_id)
    for bad in ({"stage": "save_the_date", "when": "now"},
                {"stage": "reminder", "when": "yesterday"},
                {"stage": "reminder", "when": "2020-01-01T10:00:00+02:00"},
                {"stage": "reminder", "when": _future_il(days=10)},   # after the event
                {"stage": "reminder", "when": "now", "audience": "declined"}):
        try:
            dispatch_tool(ctx, "CreateCampaign", bad)
        except ToolError:
            continue
        raise AssertionError(f"expected ToolError for {bad}")


def test_send_window_note():
    from app.ai_tools import _in_send_window
    il = dt.timezone(dt.timedelta(hours=2))
    assert _in_send_window(dt.datetime(2026, 11, 2, 12, 0, tzinfo=il))       # Monday noon
    assert not _in_send_window(dt.datetime(2026, 11, 2, 22, 0, tzinfo=il))   # Monday 22:00
    assert not _in_send_window(dt.datetime(2026, 11, 6, 15, 0, tzinfo=il))   # Friday 15:00
    assert _in_send_window(dt.datetime(2026, 11, 6, 10, 0, tzinfo=il))       # Friday 10:00


# ---------------------------------------------------------------- party_size

def test_party_size_goes_to_expected_for_unconfirmed_guest(db):
    from app.models.models import Guest
    owner = uuid.uuid4()
    event_id = _event(db, owner)
    gid = _guest(db, event_id, "זהר", "+972500000001")
    res = dispatch_tool(_ctx(db, owner, event_id), "UpdateGuest", {"guest_name": "זהר", "party_size": 3})
    out = res["result"]
    assert out["name"] == "זהר" and out["party_size"] == 3
    assert "EXPECTED" in out["note"]
    db.expire_all()
    g = db.query(Guest).get(gid)
    assert g.import_count == 3 and g.guest_count is None and g.status == "invited"


def test_party_size_goes_to_guest_count_for_confirmed_guest(db):
    from app.models.models import Guest
    owner = uuid.uuid4()
    event_id = _event(db, owner)
    gid = _guest(db, event_id, "דנה", "+972500000002", status="confirmed", guest_count=1)
    dispatch_tool(_ctx(db, owner, event_id), "UpdateGuest", {"guest_id": str(gid), "party_size": 4})
    db.expire_all()
    g = db.query(Guest).get(gid)
    assert g.guest_count == 4 and g.import_count == 1


def test_legacy_guest_count_arg_is_mapped_by_status(db):
    from app.models.models import Guest
    owner = uuid.uuid4()
    event_id = _event(db, owner)
    gid = _guest(db, event_id, "רון", "+972500000003")
    dispatch_tool(_ctx(db, owner, event_id), "UpdateGuest", {"guest_id": str(gid), "guest_count": 3})
    db.expire_all()
    g = db.query(Guest).get(gid)
    assert g.import_count == 3 and g.guest_count is None
    # Confirming in the same call routes the size to the RSVP answer.
    dispatch_tool(_ctx(db, owner, event_id), "UpdateGuest",
                  {"guest_id": str(gid), "status": "confirmed", "party_size": 2})
    db.expire_all()
    g = db.query(Guest).get(gid)
    assert g.status == "confirmed" and g.guest_count == 2
    # Explicit import_count stays an explicit expected-count write.
    dispatch_tool(_ctx(db, owner, event_id), "UpdateGuest", {"guest_id": str(gid), "import_count": 5})
    db.expire_all()
    assert db.query(Guest).get(gid).import_count == 5


# ----------------------------------------------------------- QuestionResults

def _question(db, event_id, key, label, data_type, options=None):
    from app.models.models import EventFieldDef
    f = EventFieldDef(event_id=event_id, key=key, label=label, data_type=data_type, options=options)
    db.add(f)
    db.commit()
    db.refresh(f)
    return f.id


def _answer(db, guest_id, field_id, value):
    from app.models.models import GuestCustomValue
    db.add(GuestCustomValue(guest_id=guest_id, field_def_id=field_id, value=value))
    db.commit()


def test_question_results_counts_and_names(db):
    owner = uuid.uuid4()
    event_id = _event(db, owner)
    shuttle = _question(db, event_id, "shuttle", "צריכים הסעה?", "boolean")
    meal = _question(db, event_id, "meal", "מנה מועדפת", "enum", ["בשר", "צמחוני", "טבעוני"])
    a = _guest(db, event_id, "זהר", "+972500000001", status="confirmed", guest_count=2)
    b = _guest(db, event_id, "דנה", "+972500000002", status="confirmed", guest_count=1)
    c = _guest(db, event_id, "רון", "+972500000003", status="confirmed", guest_count=1)
    _answer(db, a, shuttle, True)
    _answer(db, b, shuttle, False)
    _answer(db, a, meal, "צמחוני")
    _answer(db, b, meal, "צמחוני")
    ctx = _ctx(db, owner, event_id)

    listing = dispatch_tool(ctx, "QuestionResults", {})["result"]
    assert {q["key"] for q in listing["questions"]} == {"shuttle", "meal"}

    res = dispatch_tool(ctx, "QuestionResults", {"question": "הסעה"})["result"]
    by = {r["answer"]: r for r in res["results"]}
    assert by["כן"]["count"] == 1 and by["כן"]["people"] == 2
    assert [g["name"] for g in by["כן"]["guests"]] == ["זהר"]
    assert by["לא"]["count"] == 1
    assert res["confirmed_without_answer"] == 1
    assert res["confirmed_without_answer_names"] == ["רון"]

    res = dispatch_tool(ctx, "QuestionResults", {"question": "meal"})["result"]
    by = {r["answer"]: r["count"] for r in res["results"]}
    assert by == {"בשר": 0, "צמחוני": 2, "טבעוני": 0}
    assert c  # unused guest kept for the "without answer" count


def test_question_results_unknown_question(db):
    owner = uuid.uuid4()
    event_id = _event(db, owner)
    _question(db, event_id, "shuttle", "צריכים הסעה?", "boolean")
    try:
        dispatch_tool(_ctx(db, owner, event_id), "QuestionResults", {"question": "חניה"})
    except ToolError as e:
        assert "shuttle" in str(e)
    else:
        raise AssertionError("expected ToolError")


def test_question_results_isolated_per_event(db):
    owner = uuid.uuid4()
    ev_a = _event(db, owner)
    ev_b = _event(db, owner)
    _question(db, ev_b, "shuttle", "צריכים הסעה?", "boolean")
    res = dispatch_tool(_ctx(db, owner, ev_a), "QuestionResults", {})["result"]
    assert res["questions"] == []


# ------------------------------------------------------------------ prompt

def test_prompt_formats_with_product_knowledge_and_plural_addressing():
    from app.routers import assistant as a
    text = a.SYSTEM_PROMPT.format(event_name="החתונה", event_date="2026-12-01", now="now",
                                  plans="  * Basic: ₪39")
    for label in ("סקירה", "תמונת מצב", "מוזמנים", "סבבי שליחה", "הושבה", "דף ההזמנה", "הגדרות",
                  "חבילה ותשלום", "CreateCampaign", "QuestionResults", "תרצו"):
        assert label in text, label
    assert "רוצה שאשלח" not in text


def test_plans_formatting_skips_free_and_uses_round_ssot():
    from app.routers.assistant import _format_plans
    out = _format_plans([
        {"id": "free", "title": "Free", "price": "₪0", "countLimit": 25},
        {"id": "basic", "title": "Basic", "price": "₪39", "countLimit": 50},
        {"id": "plus", "title": "Plus", "price": "₪99", "countLimit": 250},
        {"id": "pro", "title": "Pro", "price": "₪199", "countLimit": None},
    ])
    assert "Free" not in out
    assert "Basic: ₪39 - עד 50 אורחים, 2 סבבי" in out
    assert "Plus: ₪99 - עד 250 אורחים, 4 סבבי" in out
    assert "Pro: ₪199 - ללא הגבלת אורחים, 4 סבבי" in out


def test_plans_knowledge_falls_back_when_aub_unreachable(monkeypatch):
    from app.routers import assistant as a
    monkeypatch.setattr(a, "_PLANS_CACHE", {"at": 0.0, "text": None})
    monkeypatch.setenv("AUB_SERVICE_URL", "http://disabled.invalid")
    assert "חבילה ותשלום" in a.plans_knowledge()
