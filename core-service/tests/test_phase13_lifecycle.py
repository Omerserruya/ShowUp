"""Phase 13 - Event lifecycle + template archival tests."""
from __future__ import annotations

import uuid

from shared.domain.roles import Role
from shared.domain.enums import EventState
from shared.domain.lifecycle import can_transition_event, is_live
from tests.conftest import auth_header, make_account_with_event


def _owned_event(db):
    owner = uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    return owner, event_id


def test_lifecycle_rules_unit():
    assert can_transition_event(EventState.DRAFT, EventState.ACTIVE)
    assert can_transition_event("active", "completed")
    assert can_transition_event("completed", "archived")
    assert not can_transition_event("active", "archived")
    assert not can_transition_event("archived", "active")
    assert is_live(EventState.ACTIVE) and not is_live(EventState.ARCHIVED)


def test_valid_transition_chain(client, db):
    owner, event_id = _owned_event(db)  # starts 'active'
    r = client.post(f"/events/{event_id}/transition", json={"to": "completed"}, headers=auth_header(owner))
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "completed"
    r2 = client.post(f"/events/{event_id}/transition", json={"to": "archived"}, headers=auth_header(owner))
    assert r2.json()["state"] == "archived"


def test_illegal_transition_rejected(client, db):
    owner, event_id = _owned_event(db)
    r = client.post(f"/events/{event_id}/transition", json={"to": "archived"}, headers=auth_header(owner))
    assert r.status_code == 409


def test_cancel_event(client, db):
    owner, event_id = _owned_event(db)
    r = client.post(f"/events/{event_id}/transition", json={"to": "cancelled"}, headers=auth_header(owner))
    assert r.status_code == 200
    assert r.json()["state"] == "cancelled"


def test_completing_event_archives_templates(client, db):
    owner, event_id = _owned_event(db)
    # Build an active template.
    tid = client.post(f"/events/{event_id}/templates",
                      json={"name": "Invite", "body": "Hi {{guest_name}}"},
                      headers=auth_header(owner)).json()["id"]
    client.post(f"/templates/{tid}/validate", headers=auth_header(owner))
    for to in ("meta_pending", "approved", "active"):
        client.post(f"/templates/{tid}/transition", json={"to": to}, headers=auth_header(owner))

    # Completing the event archives its live templates.
    client.post(f"/events/{event_id}/transition", json={"to": "completed"}, headers=auth_header(owner))
    templates = client.get(f"/events/{event_id}/templates", headers=auth_header(owner)).json()
    assert templates[0]["lifecycle"] == "archived"
