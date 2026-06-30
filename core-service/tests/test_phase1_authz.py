"""Phase 1 - Security Foundation regression tests.

Proves the IDOR fixes: by-id guest/campaign endpoints must verify tenant
ownership, unauthenticated access is rejected, and the public /events/test
bypass is gone.
"""
from __future__ import annotations

import uuid

from tests.conftest import auth_header, make_event, make_guest, make_campaign


# ----------------------------- Guests -----------------------------

def test_owner_can_get_own_guest(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    guest_id = make_guest(db, event_id)

    r = client.get(f"/guests/{guest_id}", headers=auth_header(owner))
    assert r.status_code == 200
    assert r.json()["id"] == str(guest_id)


def test_other_tenant_cannot_get_guest(client, db):
    owner = uuid.uuid4()
    attacker = uuid.uuid4()
    event_id = make_event(db, owner)
    guest_id = make_guest(db, event_id)

    r = client.get(f"/guests/{guest_id}", headers=auth_header(attacker))
    assert r.status_code == 404  # 404 not 403: don't leak existence


def test_other_tenant_cannot_update_guest(client, db):
    owner = uuid.uuid4()
    attacker = uuid.uuid4()
    event_id = make_event(db, owner)
    guest_id = make_guest(db, event_id)

    r = client.put(f"/guests/{guest_id}", json={"status": "declined"}, headers=auth_header(attacker))
    assert r.status_code == 404

    # And the guest must be unchanged.
    from app.models.models import Guest
    db.expire_all()
    g = db.query(Guest).filter(Guest.id == str(guest_id)).first()
    assert g.status == "invited"


def test_other_tenant_cannot_delete_guest(client, db):
    owner = uuid.uuid4()
    attacker = uuid.uuid4()
    event_id = make_event(db, owner)
    guest_id = make_guest(db, event_id)

    r = client.delete(f"/guests/{guest_id}", headers=auth_header(attacker))
    assert r.status_code == 404

    from app.models.models import Guest
    assert db.query(Guest).filter(Guest.id == str(guest_id)).first() is not None


def test_unauthenticated_guest_access_rejected(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    guest_id = make_guest(db, event_id)

    assert client.get(f"/guests/{guest_id}").status_code == 401


# ---------------------------- Campaigns ----------------------------

def test_owner_can_get_own_campaign(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    campaign_id = make_campaign(db, event_id)

    r = client.get(f"/campaigns/{campaign_id}", headers=auth_header(owner))
    assert r.status_code == 200
    assert r.json()["id"] == str(campaign_id)


def test_other_tenant_cannot_get_campaign(client, db):
    owner = uuid.uuid4()
    attacker = uuid.uuid4()
    event_id = make_event(db, owner)
    campaign_id = make_campaign(db, event_id)

    assert client.get(f"/campaigns/{campaign_id}", headers=auth_header(attacker)).status_code == 404


def test_other_tenant_cannot_delete_campaign(client, db):
    owner = uuid.uuid4()
    attacker = uuid.uuid4()
    event_id = make_event(db, owner)
    campaign_id = make_campaign(db, event_id)

    r = client.delete(f"/campaigns/{campaign_id}", headers=auth_header(attacker))
    assert r.status_code == 404

    from app.models.models import Campaign
    assert db.query(Campaign).filter(Campaign.id == str(campaign_id)).first() is not None


# -------------------------- Bypass removed --------------------------

def test_events_test_bypass_removed(client):
    # Was previously an unauthenticated 200; must no longer be a public 200.
    assert client.get("/events/test").status_code != 200
