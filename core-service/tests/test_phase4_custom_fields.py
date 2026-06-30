"""Phase 4 - Custom fields tests."""
from __future__ import annotations

import uuid

from shared.domain.roles import Role
from tests.conftest import auth_header, make_account_with_event, make_guest


def _event(db):
    owner = uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    return owner, event_id


def test_create_and_list_field(client, db):
    owner, event_id = _event(db)
    r = client.post(f"/events/{event_id}/fields",
                    json={"key": "meal", "label": "Meal", "data_type": "enum", "options": ["fish", "meat"]},
                    headers=auth_header(owner))
    assert r.status_code == 201, r.text
    r2 = client.get(f"/events/{event_id}/fields", headers=auth_header(owner))
    assert r2.status_code == 200
    assert [f["key"] for f in r2.json()] == ["meal"]


def test_enum_requires_options(client, db):
    owner, event_id = _event(db)
    r = client.post(f"/events/{event_id}/fields",
                    json={"key": "meal", "label": "Meal", "data_type": "enum"},
                    headers=auth_header(owner))
    assert r.status_code == 422


def test_set_and_get_custom_values(client, db):
    owner, event_id = _event(db)
    client.post(f"/events/{event_id}/fields",
                json={"key": "meal", "label": "Meal", "data_type": "enum", "options": ["fish", "meat"]},
                headers=auth_header(owner))
    client.post(f"/events/{event_id}/fields",
                json={"key": "seats", "label": "Seats", "data_type": "number"},
                headers=auth_header(owner))
    guest_id = make_guest(db, event_id)

    r = client.put(f"/guests/{guest_id}/custom", json={"meal": "fish", "seats": 3}, headers=auth_header(owner))
    assert r.status_code == 200, r.text
    assert r.json() == {"meal": "fish", "seats": 3}

    r2 = client.get(f"/guests/{guest_id}/custom", headers=auth_header(owner))
    assert r2.json() == {"meal": "fish", "seats": 3}


def test_value_type_and_enum_validation(client, db):
    owner, event_id = _event(db)
    client.post(f"/events/{event_id}/fields",
                json={"key": "meal", "label": "Meal", "data_type": "enum", "options": ["fish", "meat"]},
                headers=auth_header(owner))
    client.post(f"/events/{event_id}/fields",
                json={"key": "seats", "label": "Seats", "data_type": "number"},
                headers=auth_header(owner))
    guest_id = make_guest(db, event_id)

    assert client.put(f"/guests/{guest_id}/custom", json={"seats": "abc"}, headers=auth_header(owner)).status_code == 422
    assert client.put(f"/guests/{guest_id}/custom", json={"meal": "chicken"}, headers=auth_header(owner)).status_code == 422
    assert client.put(f"/guests/{guest_id}/custom", json={"unknown": 1}, headers=auth_header(owner)).status_code == 422


def test_field_management_requires_event_write(client, db):
    # A viewer cannot create field definitions.
    viewer = uuid.uuid4()
    _, event_id = make_account_with_event(db, {viewer: Role.VIEWER.value})
    r = client.post(f"/events/{event_id}/fields",
                    json={"key": "x", "label": "X", "data_type": "text"},
                    headers=auth_header(viewer))
    assert r.status_code == 403
