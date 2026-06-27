"""Phase 3 — Tenancy & RBAC tests.

Covers the permission matrix (unit) and membership-scoped access enforcement
through the real HTTP + middleware + authz stack.
"""
from __future__ import annotations

import uuid

from shared.domain.roles import Role, Action, can
from tests.conftest import auth_header, make_account_with_event, make_guest


# --------------------------- matrix (unit) ---------------------------

def test_matrix_owner_full():
    for action in Action:
        assert can(Role.OWNER, action) is True


def test_matrix_manager_cannot_delete_event_or_billing():
    assert can(Role.MANAGER, Action.GUEST_DELETE) is True
    assert can(Role.MANAGER, Action.CAMPAIGN_DELETE) is True
    assert can(Role.MANAGER, Action.EVENT_DELETE) is False
    assert can(Role.MANAGER, Action.BILLING_MANAGE) is False


def test_matrix_editor_no_delete():
    assert can(Role.EDITOR, Action.GUEST_WRITE) is True
    assert can(Role.EDITOR, Action.GUEST_DELETE) is False
    assert can(Role.EDITOR, Action.CAMPAIGN_WRITE) is True
    assert can(Role.EDITOR, Action.EVENT_WRITE) is False


def test_matrix_viewer_read_only():
    assert can(Role.VIEWER, Action.GUEST_READ) is True
    assert can(Role.VIEWER, Action.GUEST_WRITE) is False


def test_matrix_guest_coordinator():
    assert can(Role.GUEST_COORDINATOR, Action.GUEST_WRITE) is True   # manual overrides
    assert can(Role.GUEST_COORDINATOR, Action.GUEST_DELETE) is False
    assert can(Role.GUEST_COORDINATOR, Action.CAMPAIGN_WRITE) is False


# ----------------------- membership enforcement -----------------------

def test_viewer_can_read_but_not_delete_guest(client, db):
    viewer = uuid.uuid4()
    _, event_id = make_account_with_event(db, {viewer: Role.VIEWER.value})
    guest_id = make_guest(db, event_id)

    assert client.get(f"/guests/{guest_id}", headers=auth_header(viewer)).status_code == 200
    assert client.delete(f"/guests/{guest_id}", headers=auth_header(viewer)).status_code == 403


def test_guest_coordinator_can_update_but_not_delete(client, db):
    coord = uuid.uuid4()
    _, event_id = make_account_with_event(db, {coord: Role.GUEST_COORDINATOR.value})
    guest_id = make_guest(db, event_id)

    assert client.put(f"/guests/{guest_id}", json={"status": "confirmed"},
                      headers=auth_header(coord)).status_code == 200
    assert client.delete(f"/guests/{guest_id}", headers=auth_header(coord)).status_code == 403


def test_manager_can_delete_guest(client, db):
    manager = uuid.uuid4()
    _, event_id = make_account_with_event(db, {manager: Role.MANAGER.value})
    guest_id = make_guest(db, event_id)

    assert client.delete(f"/guests/{guest_id}", headers=auth_header(manager)).status_code == 204


def test_non_member_gets_404(client, db):
    member = uuid.uuid4()
    outsider = uuid.uuid4()
    _, event_id = make_account_with_event(db, {member: Role.OWNER.value})
    guest_id = make_guest(db, event_id)

    assert client.get(f"/guests/{guest_id}", headers=auth_header(outsider)).status_code == 404


def test_event_create_binds_account(client, db):
    user = uuid.uuid4()
    r = client.post("/events", json={"name": "My Wedding"}, headers=auth_header(user))
    assert r.status_code == 201
    event_id = r.json()["id"]

    # The creator is now an OWNER member and can act on the event's guests.
    from app.models.models import Event, Membership
    db.expire_all()
    event = db.query(Event).filter(Event.id == event_id).first()
    assert event.account_id is not None
    m = db.query(Membership).filter(Membership.account_id == event.account_id,
                                    Membership.user_id == user).first()
    assert m is not None and m.role == Role.OWNER.value
