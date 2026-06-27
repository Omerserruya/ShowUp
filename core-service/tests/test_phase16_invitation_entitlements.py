"""Phase 16 — plan entitlements (tier RBAC) + public web invitation / RSVP."""
from __future__ import annotations

import uuid

from tests.conftest import auth_header, make_event


def _event_with_plan(db, owner_id, plan_id):
    from app.models.models import Event
    event = Event(owners=[str(owner_id)], inviters=[], name="Plan Event", active=True, plan_id=plan_id)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event.id


# ---- entitlements matrix ----

def test_entitlements_matrix_is_public(client):
    r = client.get("/entitlements")
    assert r.status_code == 200
    body = r.json()
    assert "whatsapp_campaigns" in body["features"]
    # Free excludes WhatsApp + AI; Pro includes both.
    assert "whatsapp_campaigns" not in body["plans"]["free"]
    assert "web_invitation" in body["plans"]["free"]
    assert "ai_assistant" in body["plans"]["pro"]


def test_plan_entitlements_unknown_plan_is_fully_entitled(client):
    r = client.get("/entitlements/mystery")
    assert r.status_code == 200
    feats = r.json()["features"]
    assert "ai_assistant" in feats and "whatsapp_campaigns" in feats


# ---- tier gate on campaigns ----

def test_free_plan_blocks_whatsapp_campaigns(client, db):
    owner = uuid.uuid4()
    event_id = _event_with_plan(db, owner, "free")
    r = client.post(
        f"/campaigns?event_id={event_id}",
        json={"name": "Round", "template": "event_no_pic", "channel": "whatsapp"},
        headers=auth_header(owner),
    )
    assert r.status_code == 403
    assert "feature" in r.json()["detail"].lower()


def test_legacy_plan_allows_campaigns(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)  # plan_id is None -> legacy, fully entitled
    r = client.post(
        f"/campaigns?event_id={event_id}",
        json={"name": "Round", "template": "event_no_pic", "channel": "whatsapp"},
        headers=auth_header(owner),
    )
    assert r.status_code != 403


# ---- public web invitation + open-form RSVP ----

def test_public_invitation_lifecycle(client, db):
    owner = uuid.uuid4()
    event_id = _event_with_plan(db, owner, "free")

    # Unpublished -> not visible publicly.
    assert client.get(f"/public/invite/whatever").status_code == 404

    # Owner saves design + publishes.
    cfg = {"envelope": {"color": "#fff", "stampText": "M&I"}, "personalText": "Hi!", "rsvpEnabled": True}
    r = client.put(f"/events/{event_id}/invitation", json=cfg, headers=auth_header(owner))
    assert r.status_code == 200
    r = client.post(f"/events/{event_id}/invitation/publish", json={"slug": "matan-ido"}, headers=auth_header(owner))
    assert r.status_code == 200
    assert r.json()["publicSlug"] == "matan-ido"

    # Public read (no auth) returns safe fields only.
    r = client.get("/public/invite/matan-ido")
    assert r.status_code == 200
    pub = r.json()
    assert pub["name"] == "Plan Event"
    assert pub["invitation"]["personalText"] == "Hi!"
    assert "owners" not in pub and "guests" not in pub

    # Open-form RSVP (no auth) creates a guest.
    r = client.post(
        "/public/invite/matan-ido/rsvp",
        json={"name": "Dana", "phone": "0501234567", "partySize": 3, "status": "confirmed"},
    )
    assert r.status_code == 201
    assert r.json()["status"] == "confirmed"

    # Re-submitting the same phone updates instead of duplicating.
    r = client.post(
        "/public/invite/matan-ido/rsvp",
        json={"name": "Dana", "phone": "0501234567", "partySize": 2, "status": "declined"},
    )
    assert r.status_code == 201
    assert r.json()["updated"] is True

    from app.models.models import Guest
    guests = db.query(Guest).filter(Guest.event_id == str(event_id)).all()
    assert len(guests) == 1
    assert guests[0].status == "declined"


def test_public_rsvp_requires_published_event(client, db):
    owner = uuid.uuid4()
    event_id = _event_with_plan(db, owner, "free")
    # Saved but never published.
    client.put(f"/events/{event_id}/invitation", json={"rsvpEnabled": True}, headers=auth_header(owner))
    r = client.post(
        "/public/invite/ghost/rsvp",
        json={"name": "X", "phone": "0500000000"},
    )
    assert r.status_code == 404
