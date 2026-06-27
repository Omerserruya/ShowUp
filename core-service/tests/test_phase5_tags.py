"""Phase 5 — Tags tests."""
from __future__ import annotations

import uuid

from shared.domain.roles import Role
from tests.conftest import auth_header, make_account_with_event, make_guest


def _event(db, role=Role.OWNER):
    user = uuid.uuid4()
    _, event_id = make_account_with_event(db, {user: role.value})
    return user, event_id


def test_create_and_list_tag(client, db):
    owner, event_id = _event(db)
    r = client.post(f"/events/{event_id}/tags", json={"name": "VIP", "color": "#f00"}, headers=auth_header(owner))
    assert r.status_code == 201, r.text
    r2 = client.get(f"/events/{event_id}/tags", headers=auth_header(owner))
    assert [t["name"] for t in r2.json()] == ["VIP"]


def test_duplicate_tag_name_conflict(client, db):
    owner, event_id = _event(db)
    client.post(f"/events/{event_id}/tags", json={"name": "VIP"}, headers=auth_header(owner))
    r = client.post(f"/events/{event_id}/tags", json={"name": "VIP"}, headers=auth_header(owner))
    assert r.status_code == 409


def test_assign_and_filter_by_tag(client, db):
    owner, event_id = _event(db)
    tag_id = client.post(f"/events/{event_id}/tags", json={"name": "Transportation"},
                         headers=auth_header(owner)).json()["id"]
    g1 = make_guest(db, event_id, phone="+972500000001")
    g2 = make_guest(db, event_id, phone="+972500000002")

    assert client.post(f"/guests/{g1}/tags/{tag_id}", headers=auth_header(owner)).status_code == 204

    r = client.get(f"/guests?event_id={event_id}&tag_id={tag_id}", headers=auth_header(owner))
    assert r.status_code == 200
    ids = {g["id"] for g in r.json()}
    assert str(g1) in ids and str(g2) not in ids


def test_unassign_tag(client, db):
    owner, event_id = _event(db)
    tag_id = client.post(f"/events/{event_id}/tags", json={"name": "Family"},
                         headers=auth_header(owner)).json()["id"]
    g1 = make_guest(db, event_id)
    client.post(f"/guests/{g1}/tags/{tag_id}", headers=auth_header(owner))
    assert client.delete(f"/guests/{g1}/tags/{tag_id}", headers=auth_header(owner)).status_code == 204

    r = client.get(f"/guests?event_id={event_id}&tag_id={tag_id}", headers=auth_header(owner))
    assert r.json() == []


def test_assign_unknown_tag_404(client, db):
    owner, event_id = _event(db)
    g1 = make_guest(db, event_id)
    assert client.post(f"/guests/{g1}/tags/{uuid.uuid4()}", headers=auth_header(owner)).status_code == 404
