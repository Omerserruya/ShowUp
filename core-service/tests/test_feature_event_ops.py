"""Tests for Event Templates (clone/usable), Event Clone, Import Mapping Wizard."""
from __future__ import annotations

import uuid

from shared.domain.roles import Role
from tests.conftest import auth_header, make_account_with_event, make_guest


def _event(db):
    owner = uuid.uuid4()
    account_id, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    return owner, account_id, event_id


# ----------------------------- Event Templates -----------------------------

def test_clone_template_into_event(client, db):
    owner, _, event_id = _event(db)
    src = client.post(f"/events/{event_id}/templates",
                      json={"name": "Base", "body": "Hi {{guest_name}}"},
                      headers=auth_header(owner)).json()["id"]
    r = client.post(f"/events/{event_id}/templates/{src}/clone", headers=auth_header(owner))
    assert r.status_code == 201, r.text
    assert r.json()["lifecycle"] == "draft"
    assert r.json()["name"].endswith("(copy)")


def test_usable_templates_only_approved_active(client, db):
    owner, _, event_id = _event(db)
    # draft template -> not usable
    t1 = client.post(f"/events/{event_id}/templates", json={"name": "Draft", "body": "Hi {{guest_name}}"},
                     headers=auth_header(owner)).json()["id"]
    # approved/active template -> usable
    t2 = client.post(f"/events/{event_id}/templates", json={"name": "Live", "body": "Hi {{guest_name}}"},
                     headers=auth_header(owner)).json()["id"]
    client.post(f"/templates/{t2}/validate", headers=auth_header(owner))
    for to in ("meta_pending", "approved"):
        client.post(f"/templates/{t2}/transition", json={"to": to}, headers=auth_header(owner))

    usable = client.get(f"/events/{event_id}/templates/usable", headers=auth_header(owner)).json()
    ids = {t["id"] for t in usable}
    assert t2 in ids and t1 not in ids


# ------------------------------- Event Clone -------------------------------

def test_clone_event_copies_config_and_fields(client, db):
    owner, _, event_id = _event(db)
    client.post(f"/events/{event_id}/fields",
                json={"key": "meal", "label": "Meal", "data_type": "text"}, headers=auth_header(owner))
    make_guest(db, event_id)

    r = client.post(f"/events/{event_id}/clone", json={"name": "Wedding v2", "include_guests": False},
                    headers=auth_header(owner))
    assert r.status_code == 201, r.text
    new_id = r.json()["id"]
    assert r.json()["state"] == "draft"
    # field defs copied
    fields = client.get(f"/events/{new_id}/fields", headers=auth_header(owner)).json()
    assert [f["key"] for f in fields] == ["meal"]
    # guests NOT copied
    guests = client.get(f"/guests?event_id={new_id}", headers=auth_header(owner)).json()
    assert guests == []


def test_clone_event_with_guests(client, db):
    owner, _, event_id = _event(db)
    make_guest(db, event_id, phone="+972500000041")
    r = client.post(f"/events/{event_id}/clone", json={"include_guests": True}, headers=auth_header(owner))
    new_id = r.json()["id"]
    guests = client.get(f"/guests?event_id={new_id}", headers=auth_header(owner)).json()
    assert len(guests) == 1
    assert guests[0]["status"] == "invited"  # reset


# --------------------------- Import Mapping Wizard ---------------------------

def test_suggest_mapping(client, db):
    owner, _, event_id = _event(db)
    client.post(f"/events/{event_id}/fields",
                json={"key": "meal", "label": "Meal", "data_type": "text"}, headers=auth_header(owner))
    r = client.post(f"/events/{event_id}/import/suggest-mapping",
                    json={"headers": ["שם מלא", "טלפון", "Meal", "Unknown Col"]},
                    headers=auth_header(owner))
    assert r.status_code == 200, r.text
    m = r.json()["mapping"]
    assert m["שם מלא"] == "name"
    assert m["טלפון"] == "phone"
    assert m["Meal"] == "meal"           # custom field key (case-insensitive)
    assert m["Unknown Col"] is None


def test_apply_import_creates_guests_and_custom_values(client, db):
    owner, _, event_id = _event(db)
    client.post(f"/events/{event_id}/fields",
                json={"key": "meal", "label": "Meal", "data_type": "text"}, headers=auth_header(owner))
    body = {
        "mapping": {"Name": "name", "Phone": "phone", "Meal": "meal", "Junk": None},
        "rows": [
            {"Name": "David Levi", "Phone": "+972500000051", "Meal": "fish", "Junk": "x"},
            {"Name": "No Phone", "Phone": "", "Meal": "meat"},   # skipped
        ],
    }
    r = client.post(f"/events/{event_id}/import/apply", json=body, headers=auth_header(owner))
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 1
    assert r.json()["skipped"] == 1

    gid = r.json()["guest_ids"][0]
    custom = client.get(f"/guests/{gid}/custom", headers=auth_header(owner)).json()
    assert custom == {"meal": "fish"}
