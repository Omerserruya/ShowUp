"""POST /events/{id}/test-send + GET /events/{id}/invitation-round (host onboarding).

Publishing and the aub user lookup are mocked: we assert the envelope that would
reach outpost, the auth matrix, the rate limit and the "not sendable" refusal.
"""
from __future__ import annotations

import uuid

import pytest

from tests.conftest import auth_header


HOST_PHONE = "+972501234567"


@pytest.fixture()
def published(monkeypatch):
    from app.routers import test_send as ts
    sent = []
    monkeypatch.setattr(ts, "publish_outpost_priority", lambda m: sent.append(m))
    monkeypatch.setattr(
        "app.user_directory.resolve_users_by_ids",
        lambda ids: {str(i): {"user_id": str(i), "first_name": "דנה", "last_name": "כהן", "phone": HOST_PHONE} for i in ids},
    )
    ts._reset_rate_limit()
    yield sent
    ts._reset_rate_limit()


def _event(db, owner_id, event_type="wedding"):
    from app.models.models import Event
    ev = Event(owners=[str(owner_id)], inviters=[], name="החתונה של דנה ויואב", active=True,
               event_type=event_type, subjects={"p1": "דנה", "p2": "יואב"})
    db.add(ev)
    db.commit()
    db.refresh(ev)
    return ev.id


def _campaign(db, event_id, template="event_no_pic", status="pending"):
    from app.models.models import Campaign
    c = Campaign(event_id=str(event_id), name="הזמנה", template=template, channel="whatsapp", status=status)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c.id


def test_test_send_publishes_real_template_to_host(client, db, published):
    owner = uuid.uuid4()
    eid = _event(db, owner)
    cid = _campaign(db, eid)

    r = client.post(f"/events/{eid}/test-send", json={}, headers=auth_header(owner))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "sent"
    assert body["to"] == "***4567"
    assert body["campaign_id"] == str(cid)

    assert len(published) == 1
    m = published[0]
    assert m["recipient"] == "972501234567"
    assert m["message_type"] == "template"
    assert m["template"]  # the real Meta template name of the event-type variant
    assert m["source"] == "test_send"
    # Never touches campaign bookkeeping or opens an RSVP conversation.
    assert m.get("campaign_id") is None and m.get("guest_id") is None and m.get("event_id") is None
    # Rendered for a pseudo-guest named after the host.
    assert "דנה" in str(m["parameters"])


def test_test_send_does_not_write_messages_sent(client, db, published):
    from sqlalchemy import text
    owner = uuid.uuid4()
    eid = _event(db, owner)
    _campaign(db, eid)
    assert client.post(f"/events/{eid}/test-send", json={}, headers=auth_header(owner)).status_code == 200
    try:
        n = db.execute(text("SELECT count(*) FROM messages_sent")).scalar()
    except Exception:
        db.rollback()
        n = 0
    assert n == 0


def test_test_send_rate_limited(client, db, published):
    owner = uuid.uuid4()
    eid = _event(db, owner)
    _campaign(db, eid)
    for _ in range(5):
        assert client.post(f"/events/{eid}/test-send", json={}, headers=auth_header(owner)).status_code == 200
    r = client.post(f"/events/{eid}/test-send", json={}, headers=auth_header(owner))
    assert r.status_code == 429
    assert len(published) == 5


def test_test_send_rejects_unsendable_template(client, db, published):
    owner = uuid.uuid4()
    eid = _event(db, owner)
    cid = _campaign(db, eid, template="invitation_funny")
    r = client.post(f"/events/{eid}/test-send", json={"campaign_id": str(cid)}, headers=auth_header(owner))
    assert r.status_code == 400
    assert "לא מאושר" in r.json()["detail"]
    assert published == []


def test_test_send_requires_membership(client, db, published):
    owner = uuid.uuid4()
    eid = _event(db, owner)
    _campaign(db, eid)
    r = client.post(f"/events/{eid}/test-send", json={}, headers=auth_header(uuid.uuid4()))
    assert r.status_code == 404
    assert published == []


def test_test_send_without_invitation_round(client, db, published):
    owner = uuid.uuid4()
    eid = _event(db, owner)
    r = client.post(f"/events/{eid}/test-send", json={}, headers=auth_header(owner))
    assert r.status_code == 404


def test_invitation_round_summary(client, db, published):
    owner = uuid.uuid4()
    eid = _event(db, owner)
    cid = _campaign(db, eid)
    r = client.get(f"/events/{eid}/invitation-round", headers=auth_header(owner))
    assert r.status_code == 200, r.text
    rnd = r.json()["round"]
    assert rnd["campaign_id"] == str(cid)
    assert rnd["sendable"] is True
    assert rnd["template_title"]
