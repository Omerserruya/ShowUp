"""Phase 8 - Template engine + lifecycle tests."""
from __future__ import annotations

import uuid

from shared.domain.roles import Role
from shared.domain.enums import TemplateState
from shared.domain.templates import validate_template_body, can_transition, is_usable, extract_vars
from tests.conftest import auth_header, make_account_with_event


# ----------------------------- unit (SSOT) -----------------------------

def test_validate_allows_known_vars():
    used = validate_template_body("Hi {{guest_name}}, see you at {{venue}} on {{event_date}}")
    assert used == {"guest_name", "venue", "event_date"}


def test_validate_rejects_unknown_var():
    try:
        validate_template_body("Hi {{ssn}}")
        assert False, "should have raised"
    except ValueError:
        pass


def test_extra_allowed_vars():
    assert validate_template_body("Meal: {{meal}}", extra_allowed=["meal"]) == {"meal"}


def test_lifecycle_rules():
    assert can_transition(TemplateState.DRAFT, TemplateState.VALIDATED)
    assert not can_transition(TemplateState.DRAFT, TemplateState.APPROVED)
    assert can_transition("approved", "active")
    assert is_usable(TemplateState.APPROVED) and is_usable("active")
    assert not is_usable(TemplateState.DRAFT)


# ----------------------------- API -----------------------------

def _event(db):
    owner = uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    return owner, event_id


def _create(client, owner, event_id, body):
    return client.post(f"/events/{event_id}/templates",
                       json={"name": "Invite", "body": body},
                       headers=auth_header(owner))


def test_create_and_validate_flow(client, db):
    owner, event_id = _event(db)
    r = _create(client, owner, event_id, "Hi {{guest_name}}, {{event_name}} awaits!")
    assert r.status_code == 201, r.text
    tid = r.json()["id"]
    assert r.json()["lifecycle"] == "draft"

    v = client.post(f"/templates/{tid}/validate", headers=auth_header(owner))
    assert v.status_code == 200, v.text
    assert v.json()["lifecycle"] == "validated"
    assert set(v.json()["allowed_vars"]) == {"guest_name", "event_name"}


def test_validate_unknown_var_rejected(client, db):
    owner, event_id = _event(db)
    tid = _create(client, owner, event_id, "Hi {{evil_var}}").json()["id"]
    v = client.post(f"/templates/{tid}/validate", headers=auth_header(owner))
    assert v.status_code == 422
    # remains draft
    lst = client.get(f"/events/{event_id}/templates", headers=auth_header(owner)).json()
    assert lst[0]["lifecycle"] == "draft"


def test_validate_accepts_custom_field_var(client, db):
    owner, event_id = _event(db)
    client.post(f"/events/{event_id}/fields",
                json={"key": "meal", "label": "Meal", "data_type": "text", "applies_to_template": True},
                headers=auth_header(owner))
    tid = _create(client, owner, event_id, "Your meal: {{meal}}").json()["id"]
    v = client.post(f"/templates/{tid}/validate", headers=auth_header(owner))
    assert v.status_code == 200, v.text


def test_full_lifecycle_transitions(client, db):
    owner, event_id = _event(db)
    tid = _create(client, owner, event_id, "Hi {{guest_name}}").json()["id"]
    client.post(f"/templates/{tid}/validate", headers=auth_header(owner))
    for to in ("meta_pending", "approved", "active", "archived"):
        r = client.post(f"/templates/{tid}/transition", json={"to": to}, headers=auth_header(owner))
        assert r.status_code == 200, (to, r.text)
        assert r.json()["lifecycle"] == to


def test_illegal_transition_rejected(client, db):
    owner, event_id = _event(db)
    tid = _create(client, owner, event_id, "Hi {{guest_name}}").json()["id"]
    # draft -> approved is illegal
    r = client.post(f"/templates/{tid}/transition", json={"to": "approved"}, headers=auth_header(owner))
    assert r.status_code == 409
