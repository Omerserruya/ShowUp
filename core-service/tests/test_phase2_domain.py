"""Phase 2 - Domain cleanup tests.

Verifies the shared GuestStatus SSOT normalization and that stats no longer
drop 'maybe' guests and correctly fold the legacy 'attending' value into
confirmed.
"""
from __future__ import annotations

import uuid

from shared.domain.enums import GuestStatus, RsvpAction, EventState
from tests.conftest import auth_header, make_event


# ------------------------- enum SSOT -------------------------

def test_guest_status_normalize_legacy():
    assert GuestStatus.normalize("attending") is GuestStatus.CONFIRMED
    assert GuestStatus.normalize("pending") is GuestStatus.INVITED
    assert GuestStatus.normalize("confirmed") is GuestStatus.CONFIRMED
    assert GuestStatus.normalize("CONFIRMED") is GuestStatus.CONFIRMED
    assert GuestStatus.normalize("garbage") is GuestStatus.INVITED
    assert GuestStatus.normalize(None) is GuestStatus.INVITED


def test_rsvp_action_maps_to_status():
    assert RsvpAction.CONFIRMED.to_guest_status() is GuestStatus.CONFIRMED
    assert RsvpAction.DECLINED.to_guest_status() is GuestStatus.DECLINED
    assert RsvpAction.MAYBE.to_guest_status() is GuestStatus.MAYBE
    assert RsvpAction.UNKNOWN.to_guest_status() is None


def test_event_states_exist():
    assert {s.value for s in EventState} == {"draft", "active", "completed", "archived", "cancelled"}


# ------------------------- stats fix -------------------------

def _seed_guest(db, event_id, phone, status):
    from app.models.models import Guest
    g = Guest(event_id=str(event_id), name="G", phone=phone, status=status, import_count=2)
    db.add(g)
    db.commit()


def test_stats_counts_maybe_and_legacy_attending(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    # Mixed statuses including the legacy 'attending' alias and a 'maybe'.
    _seed_guest(db, event_id, "+972500000001", "confirmed")
    _seed_guest(db, event_id, "+972500000002", "attending")  # legacy -> confirmed
    _seed_guest(db, event_id, "+972500000003", "declined")
    _seed_guest(db, event_id, "+972500000004", "maybe")
    _seed_guest(db, event_id, "+972500000005", "invited")

    r = client.get(f"/guests/stats?event_id={event_id}", headers=auth_header(owner))
    assert r.status_code == 200
    body = r.json()
    # confirmed folds 'confirmed' + legacy 'attending' = 2 guests * import_count 2 = 4
    assert body["confirmed"] == 4
    assert body["declined"] == 2          # 1 guest * 2
    assert body["maybe"] == 1             # counted, previously dropped
    assert body["pending"] == 1           # the 'invited' guest


def test_status_filter_maybe(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    _seed_guest(db, event_id, "+972500000010", "maybe")
    _seed_guest(db, event_id, "+972500000011", "confirmed")

    r = client.get(f"/guests?event_id={event_id}&status=maybe", headers=auth_header(owner))
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert items[0]["status"] == "maybe"
