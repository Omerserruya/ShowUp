"""Phase 6 - Campaign engine refactor tests.

Audience is first-class and decoupled from the template; optional follow-up
fields persist; intended recipient count reflects the audience.
"""
from __future__ import annotations

import uuid

from app.audience import count_audience
from tests.conftest import auth_header, make_event


def _seed(db, event_id, phone, status):
    from app.models.models import Guest
    db.add(Guest(event_id=str(event_id), name="G", phone=phone, status=status, import_count=1))
    db.commit()


def test_create_campaign_with_audience(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    r = client.post(f"/campaigns?event_id={event_id}",
                    json={"name": "Round 1", "template": "event_no_pic", "channel": "whatsapp",
                          "audience": "confirmed"},
                    headers=auth_header(owner))
    assert r.status_code == 201, r.text
    assert r.json()["audience"] == "confirmed"


def test_invalid_audience_rejected(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    r = client.post(f"/campaigns?event_id={event_id}",
                    json={"name": "R", "template": "event_no_pic", "channel": "whatsapp",
                          "audience": "vips_only"},
                    headers=auth_header(owner))
    assert r.status_code == 422


def test_follow_up_fields_persist(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    r = client.post(f"/campaigns?event_id={event_id}",
                    json={"name": "R1", "template": "event_no_pic", "channel": "whatsapp",
                          "audience": "everyone", "follow_up_after_hours": 48,
                          "follow_up_audience": "no_response"},
                    headers=auth_header(owner))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["follow_up_after_hours"] == 48
    assert body["follow_up_audience"] == "no_response"


def test_follow_up_hours_must_be_positive(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    r = client.post(f"/campaigns?event_id={event_id}",
                    json={"name": "R", "template": "event_no_pic", "channel": "whatsapp",
                          "follow_up_after_hours": 0},
                    headers=auth_header(owner))
    assert r.status_code == 422


def test_count_audience(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    _seed(db, event_id, "+972500000001", "confirmed")
    _seed(db, event_id, "+972500000002", "attending")  # legacy confirmed
    _seed(db, event_id, "+972500000003", "declined")
    _seed(db, event_id, "+972500000004", "invited")
    _seed(db, event_id, "+972500000005", "maybe")

    assert count_audience(db, event_id, "everyone") == 5
    assert count_audience(db, event_id, "confirmed") == 2      # confirmed + attending
    assert count_audience(db, event_id, "declined") == 1
    assert count_audience(db, event_id, "no_response") == 1    # invited
    # custom filter by explicit status list
    assert count_audience(db, event_id, "custom", {"status": ["maybe"]}) == 1


def test_intended_count_reflects_audience(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    _seed(db, event_id, "+972500000001", "confirmed")
    _seed(db, event_id, "+972500000002", "invited")
    client.post(f"/campaigns?event_id={event_id}",
                json={"name": "Confirmed blast", "template": "event_no_pic", "channel": "whatsapp",
                      "audience": "confirmed"},
                headers=auth_header(owner))

    r = client.get(f"/campaigns?event_id={event_id}", headers=auth_header(owner))
    assert r.status_code == 200
    campaign = r.json()[0]
    assert campaign["recipient_count"] == 1   # only the confirmed guest
