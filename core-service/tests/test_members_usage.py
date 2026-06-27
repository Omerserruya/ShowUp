"""Tests for the team/members router and the usage view."""
from __future__ import annotations

import uuid

from shared.domain.roles import Role
from tests.conftest import auth_header, make_account_with_event, make_guest


def test_list_members_as_owner(client, db):
    owner, mgr = uuid.uuid4(), uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value, mgr: Role.MANAGER.value})
    r = client.get(f"/members?event_id={event_id}", headers=auth_header(owner))
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 2
    assert {m["role"] for m in data} == {"owner", "manager"}
    me = [m for m in data if m["is_self"]][0]
    assert me["user_id"] == str(owner)


def test_list_members_forbidden_for_nonmember(client, db):
    owner, stranger = uuid.uuid4(), uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    r = client.get(f"/members?event_id={event_id}", headers=auth_header(stranger))
    assert r.status_code == 404


def test_invite_member_resolves_phone(client, db, monkeypatch):
    owner, invited = uuid.uuid4(), uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    monkeypatch.setattr(
        "app.routers.members.resolve_user_id_by_phone",
        lambda phone: {"user_id": str(invited), "first_name": "Dana", "last_name": "Levi", "phone": phone},
    )
    r = client.post(
        "/members/invite", headers=auth_header(owner),
        json={"event_id": str(event_id), "phone": "+972500000009", "role": "editor"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["role"] == "editor"
    assert body["user_id"] == str(invited)
    r2 = client.get(f"/members?event_id={event_id}", headers=auth_header(owner))
    assert len(r2.json()) == 2


def test_invite_unregistered_phone_404(client, db, monkeypatch):
    owner = uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    monkeypatch.setattr("app.routers.members.resolve_user_id_by_phone", lambda phone: None)
    r = client.post(
        "/members/invite", headers=auth_header(owner),
        json={"event_id": str(event_id), "phone": "+972500000009", "role": "editor"},
    )
    assert r.status_code == 404


def test_invite_owner_role_rejected(client, db, monkeypatch):
    owner = uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    monkeypatch.setattr("app.routers.members.resolve_user_id_by_phone", lambda phone: {"user_id": str(uuid.uuid4())})
    r = client.post(
        "/members/invite", headers=auth_header(owner),
        json={"event_id": str(event_id), "phone": "+9725", "role": "owner"},
    )
    assert r.status_code == 400


def test_editor_cannot_invite(client, db):
    owner, editor = uuid.uuid4(), uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value, editor: Role.EDITOR.value})
    r = client.post(
        "/members/invite", headers=auth_header(editor),
        json={"event_id": str(event_id), "phone": "+9725", "role": "viewer"},
    )
    assert r.status_code == 403


def test_update_and_remove_member(client, db):
    owner, member = uuid.uuid4(), uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value, member: Role.VIEWER.value})
    r = client.get(f"/members?event_id={event_id}", headers=auth_header(owner))
    viewer = [m for m in r.json() if m["user_id"] == str(member)][0]
    mid = viewer["id"]
    r2 = client.put(f"/members/{mid}", headers=auth_header(owner), json={"role": "manager"})
    assert r2.status_code == 200
    assert r2.json()["role"] == "manager"
    r3 = client.delete(f"/members/{mid}", headers=auth_header(owner))
    assert r3.status_code == 204
    r4 = client.get(f"/members?event_id={event_id}", headers=auth_header(owner))
    assert len(r4.json()) == 1


def test_cannot_modify_owner(client, db):
    owner, other_owner = uuid.uuid4(), uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value, other_owner: Role.OWNER.value})
    r = client.get(f"/members?event_id={event_id}", headers=auth_header(owner))
    ow = [m for m in r.json() if m["user_id"] == str(other_owner)][0]
    r2 = client.put(f"/members/{ow['id']}", headers=auth_header(owner), json={"role": "manager"})
    assert r2.status_code == 400


def test_usage_counts(client, db):
    owner = uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    make_guest(db, event_id, phone="+972500000010")
    make_guest(db, event_id, phone="+972500000011")
    r = client.get(f"/usage?event_id={event_id}", headers=auth_header(owner))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["guests_used"] == 2
    assert body["rounds_used"] == 0


def test_usage_forbidden_nonmember(client, db):
    owner, stranger = uuid.uuid4(), uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    r = client.get(f"/usage?event_id={event_id}", headers=auth_header(stranger))
    assert r.status_code == 404
