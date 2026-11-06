"""Every event is born with its round plan (app/default_rounds.py): a gift /
admin / venue event gets the plan's message rounds, a dated-later event gets
them when the date arrives, and an event that already has rounds is untouched."""
from __future__ import annotations

import datetime as dt
import uuid

from app.models.models import Campaign

FUTURE = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=70)


def _rounds(db, event_id):
    return db.query(Campaign).filter(Campaign.event_id == str(event_id)).order_by(Campaign.schedule_time).all()


def _redeem(db, plan_id, **fields):
    from app import entitlement_service
    from shared.domain.enums import EntitlementSource
    event, _ = entitlement_service.issue_and_redeem(
        db, source=EntitlementSource.ADMIN, plan_id=plan_id, owner_user_id=uuid.uuid4(), account_id=None,
        event_fields={"name": "חתונה", "event_type": "wedding", "subjects": {"p1": "נועה", "p2": "יונתן"}, **fields})
    return event


def test_gift_event_gets_the_plan_rounds(db):
    ev = _redeem(db, "pro", event_date=FUTURE)
    rounds = _rounds(db, ev.id)
    assert [c.stage_id for c in rounds] == ["invitation", "reminder", "final_reminder", "thank_you"]
    assert all(c.status == "pending" and c.schedule_time is not None for c in rounds)
    assert [c.name for c in rounds][:2] == ["אישור הגעה ראשוני", "אישור הגעה נוסף"]
    basic = _redeem(db, "basic", event_date=FUTURE)
    assert [c.stage_id for c in _rounds(db, basic.id)] == ["reminder", "final_reminder"]


def test_no_date_no_rounds_until_the_date_is_set(db):
    from app.crud import event as event_crud
    from app.schemas.schemas import EventUpdate
    ev = _redeem(db, "plus")
    assert _rounds(db, ev.id) == []
    event_crud.update_event(db, ev, EventUpdate(event_date=FUTURE))
    assert [c.stage_id for c in _rounds(db, ev.id)] == ["invitation", "reminder", "final_reminder"]


def test_existing_rounds_are_never_replaced(db):
    from app.default_rounds import ensure_default_rounds
    ev = _redeem(db, "pro", event_date=FUTURE)
    before = [c.id for c in _rounds(db, ev.id)]
    assert ensure_default_rounds(db, ev) == 0
    assert [c.id for c in _rounds(db, ev.id)] == before


def test_default_template_is_deliverable_text_only():
    from app.default_rounds import default_template_for
    from app.routers.catalog import _sendable_event_types
    for et in ("wedding", "bar", "brit", "corporate", "birthday"):
        for stage in ("reminder", "final_reminder"):
            key = default_template_for(stage, et)
            assert key and et in _sendable_event_types()[key], (et, stage, key)



def test_owner_edits_the_couple_names(db):
    """Settings -> event details: the names feed couple_names in every message;
    unknown keys are dropped and untouched keys keep their value."""
    from app.crud import event as event_crud
    from app.schemas.schemas import EventUpdate
    from shared.domain.messaging import VariableResolver
    ev = _redeem(db, "plus", event_date=FUTURE)
    event_crud.update_event(db, ev, EventUpdate(subjects={"p1": " נועה ", "role1": "bride", "p2": "יונתן",
                                                          "role2": "groom", "evil": "x", "role1x": 1}))
    assert ev.subjects["p1"] == "נועה" and ev.subjects["p2"] == "יונתן" and "evil" not in ev.subjects
    event_crud.update_event(db, ev, EventUpdate(subjects={"p2": "דן", "role2": "king"}))
    assert ev.subjects["p1"] == "נועה" and ev.subjects["p2"] == "דן" and ev.subjects["role2"] == "groom"
    vals = VariableResolver({"subjects": ev.subjects, "event_type": "wedding"}).values_for({"name": "x"})
    assert vals["couple_names"] == "נועה ודן" and vals["bride_name"] == "נועה"
