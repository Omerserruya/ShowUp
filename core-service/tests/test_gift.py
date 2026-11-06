"""Money gift (shared/domain/gift.py): the hosts' Bit/PayBox link is saved in
settings, guests reach it via /g/{code}, and a round with a gift button cannot
be scheduled before the details exist."""
from __future__ import annotations

import datetime as dt
import uuid

import pytest
from fastapi import HTTPException

FUTURE = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=70)


def _event(db):
    from app import entitlement_service
    from shared.domain.enums import EntitlementSource
    event, _ = entitlement_service.issue_and_redeem(
        db, source=EntitlementSource.ADMIN, plan_id="plus", owner_user_id=uuid.uuid4(), account_id=None,
        event_fields={"name": "חתונה", "event_type": "wedding", "event_date": FUTURE,
                      "subjects": {"p1": "נועה", "p2": "יונתן"}})
    return event


def test_owner_saves_gift_and_guests_see_it(db):
    from app.crud import event as event_crud
    from app.routers.public_gift import public_gift
    from app.schemas.schemas import EventUpdate
    from shared.domain.messaging import VariableResolver
    ev = _event(db)
    with pytest.raises(event_crud.GiftError):
        event_crud.update_event(db, ev, EventUpdate(gift={"url": "javascript:alert(1)"}))
    db.rollback()
    event_crud.update_event(db, ev, EventUpdate(gift={"url": "https://links.payboxapp.com/abc", "bit_phone": "+972 52-540-1686"}))
    code = ev.gift["code"]
    assert ev.gift["bit_phone"] == "0525401686" and len(code) >= 8
    page = public_gift(code, db)
    assert page["available"] and page["provider"] == "paybox" and page["bit_phone"] == "052-540-1686"
    assert page["hosts"] == "נועה ויונתן"
    vals = VariableResolver({"gift": ev.gift}, public_base="https://x").values_for({})
    assert vals["gift_link"] == f"https://x/g/{code}"
    # editing keeps the code (links already sent keep working); clearing closes the page
    event_crud.update_event(db, ev, EventUpdate(gift={"url": "", "bit_phone": ""}))
    assert ev.gift["code"] == code and public_gift(code, db)["available"] is False
    with pytest.raises(HTTPException):
        public_gift("nope", db)


def test_gift_button_round_needs_gift_details(db, monkeypatch):
    from app.routers import campaigns
    from shared.domain.messaging import catalog as cat
    import shared.domain.messaging as messaging
    ev = _event(db)
    class T:  # minimal stand-in: usable template with a gift button
        is_usable = True
        url_buttons = (cat.UrlButton(label="למתנה", url_var="gift_link"),)
    monkeypatch.setattr(messaging, "resolve_template", lambda *a, **k: T())
    with pytest.raises(HTTPException) as e:
        campaigns._require_deliverable_template(db, "x", None, event_type="wedding", event=ev)
    assert e.value.detail["code"] == "gift_missing"
    ev.gift = {"url": "https://bit.page.link/x", "bit_phone": "", "code": "abcdefgh"}
    campaigns._require_deliverable_template(db, "x", None, event_type="wedding", event=ev)


def test_calendar_link_and_ics(db, client):
    import datetime as dt
    from app.models.models import Event
    from shared.domain.messaging import VariableResolver
    ev = _event(db)
    db.refresh(ev)
    assert ev.share_code and len(ev.share_code) == 12
    vals = VariableResolver({"share_code": ev.share_code}, public_base="https://x").values_for({})
    assert vals["calendar_link"] == f"https://x/c/{ev.share_code}"
    r = client.get(f"/public/calendar/{ev.share_code}")
    assert r.status_code == 200 and r.json()["title"] == "חתונה"
    ics = client.get(f"/public/calendar/{ev.share_code}.ics")
    assert ics.status_code == 200 and "BEGIN:VEVENT" in ics.text and ics.headers["content-type"].startswith("text/calendar")
    assert client.get("/public/calendar/nope").status_code == 404
