"""An event cannot be created without host names (couple / parents / honoree /
company / inviters): the bot texts and templates would go out with a blank
("של   🥳"). Enforced once, at the single event-construction path."""
from __future__ import annotations

import uuid

import pytest

from tests.conftest import auth_header


def test_self_service_without_names_is_refused(client, db):
    r = client.post("/events", json={"terms_version": "2026-11-01", "name": "חתונה"}, headers=auth_header(uuid.uuid4()))
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "missing_host_names"
    r = client.post("/events", json={"terms_version": "2026-11-01", "name": "חתונה", "subjects": {"p1": "  ", "p2": ""}},
                    headers=auth_header(uuid.uuid4()))
    assert r.status_code == 422


@pytest.mark.parametrize("fields", [
    {"subjects": {"p1": "נועה"}},
    {"subjects": {"company": "אקמה"}},
    {"subjects": {"honoree": "דניאל"}},
    {"subjects": {"parent1": "רונית", "secretName": True}},
    {"inviters": [{"fn": "משפחת", "ln": "כהן"}]},
])
def test_any_host_name_is_enough(client, fields):
    r = client.post("/events", json={"terms_version": "2026-11-01", "name": "אירוע", **fields}, headers=auth_header(uuid.uuid4()))
    assert r.status_code == 201, r.text


def test_gift_link_without_names_keeps_the_code_usable(client, db):
    from app import entitlement_service
    from shared.domain.enums import EntitlementSource, EntitlementStatus

    ent = entitlement_service.issue(db, source=EntitlementSource.PROMOTION, plan_id="starter")
    user = auth_header(uuid.uuid4())
    r = client.post(f"/redeem/{ent.code}", json={"terms_version": "2026-11-01", "name": "בר מצווה"}, headers=user)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "missing_host_names"
    db.expire_all()
    assert entitlement_service.effective_status(ent) == EntitlementStatus.AVAILABLE
    r = client.post(f"/redeem/{ent.code}", json={"terms_version": "2026-11-01", "name": "בר מצווה", "subjects": {"honoree": "דניאל"}}, headers=user)
    assert r.status_code == 201


def test_a_paid_order_is_never_refused(db):
    """The money is already in - log it, but the customer gets their event."""
    from app import entitlement_service
    from shared.domain.enums import EntitlementSource

    event, created = entitlement_service.issue_and_redeem(
        db, source=EntitlementSource.PAYMENT, plan_id="plus", owner_user_id=uuid.uuid4(), account_id=None,
        event_fields={"name": "חתונה"}, order_id=f"ord-{uuid.uuid4()}")
    assert created and event.id


def test_admin_and_clone_carry_the_names(db):
    from app import entitlement_service
    from shared.domain.enums import EntitlementSource

    with pytest.raises(entitlement_service.MissingHostNames):
        entitlement_service.issue_and_redeem(
            db, source=EntitlementSource.ADMIN, plan_id="plus", owner_user_id=uuid.uuid4(), account_id=None,
            event_fields={"name": "חתונה", "event_type": "wedding"})
    db.rollback()
    event, _ = entitlement_service.issue_and_redeem(
        db, source=EntitlementSource.ADMIN, plan_id="plus", owner_user_id=uuid.uuid4(), account_id=None,
        event_fields={"name": "חתונה", "event_type": "wedding", "subjects": {"p1": "נועה", "p2": "יונתן"}})
    assert event.subjects["p1"] == "נועה"


def test_clone_copies_subjects_and_type(client, db):
    from app import entitlement_service
    from shared.domain.enums import EntitlementSource

    owner = uuid.uuid4()
    src, _ = entitlement_service.issue_and_redeem(
        db, source=EntitlementSource.ADMIN, plan_id="plus", owner_user_id=owner, account_id=None,
        event_fields={"name": "חתונה", "event_type": "wedding", "subjects": {"p1": "נועה", "p2": "יונתן"}})
    r = client.post(f"/events/{src.id}/clone", json={"include_guests": False}, headers=auth_header(owner))
    assert r.status_code in (200, 201), r.text
    from app.models.models import Event
    new = db.query(Event).filter(Event.id == uuid.UUID(r.json()["id"])).one()
    assert new.subjects["p2"] == "יונתן" and new.event_type == "wedding"


def test_terms_must_be_accepted_and_are_recorded(client, db):
    from app.models.models import Event
    from shared.domain.legal import TERMS_VERSION

    body = {"name": "חתונה", "subjects": {"p1": "נועה", "p2": "יונתן"}}
    r = client.post("/events", json=body, headers=auth_header(uuid.uuid4()))
    assert r.status_code == 422 and r.json()["detail"]["code"] == "terms_required"
    r = client.post("/events", json={**body, "terms_version": TERMS_VERSION}, headers=auth_header(uuid.uuid4()))
    assert r.status_code == 201
    ev = db.query(Event).filter(Event.id == uuid.UUID(r.json()["id"])).one()
    assert ev.terms_version == TERMS_VERSION and ev.terms_accepted_at is not None


def test_gift_link_requires_terms(client, db):
    from app import entitlement_service
    from shared.domain.enums import EntitlementSource

    ent = entitlement_service.issue(db, source=EntitlementSource.PROMOTION, plan_id="starter")
    r = client.post(f"/redeem/{ent.code}", json={"name": "בר מצווה", "subjects": {"honoree": "דניאל"}},
                    headers=auth_header(uuid.uuid4()))
    assert r.status_code == 422 and r.json()["detail"]["code"] == "terms_required"
