"""Phase 9 — Guest timeline tests."""
from __future__ import annotations

import uuid

from shared.domain.roles import Role
from tests.conftest import auth_header, make_account_with_event, make_guest


def _setup(db):
    owner = uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    guest_id = make_guest(db, event_id)
    return owner, event_id, guest_id


def test_status_change_recorded(client, db):
    owner, event_id, guest_id = _setup(db)
    r = client.put(f"/guests/{guest_id}", json={"status": "confirmed"}, headers=auth_header(owner))
    assert r.status_code == 200

    tl = client.get(f"/guests/{guest_id}/timeline", headers=auth_header(owner))
    assert tl.status_code == 200
    events = tl.json()
    assert len(events) == 1
    assert events[0]["type"] == "confirmed"
    assert events[0]["actor_type"] == "user"
    assert events[0]["data"]["status"] == "confirmed"


def test_non_status_edit_is_staff_edit(client, db):
    owner, event_id, guest_id = _setup(db)
    client.put(f"/guests/{guest_id}", json={"notes": "VIP, seat near stage"}, headers=auth_header(owner))
    events = client.get(f"/guests/{guest_id}/timeline", headers=auth_header(owner)).json()
    assert events[0]["type"] == "staff_edit"
    assert "notes" in events[0]["data"]["fields"]


def test_timeline_ordered_desc_and_accumulates(client, db):
    owner, event_id, guest_id = _setup(db)
    client.put(f"/guests/{guest_id}", json={"status": "maybe"}, headers=auth_header(owner))
    client.put(f"/guests/{guest_id}", json={"status": "confirmed"}, headers=auth_header(owner))
    events = client.get(f"/guests/{guest_id}/timeline", headers=auth_header(owner)).json()
    assert len(events) == 2
    # most recent first
    assert events[0]["type"] == "confirmed"
    assert events[1]["type"] == "maybe"


def test_timeline_requires_access(client, db):
    owner, event_id, guest_id = _setup(db)
    outsider = uuid.uuid4()
    assert client.get(f"/guests/{guest_id}/timeline", headers=auth_header(outsider)).status_code == 404
