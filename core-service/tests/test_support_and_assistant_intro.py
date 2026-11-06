"""Admin support sessions + the AI-assistant intro on every creation path.

Two invariants worth pinning down:

1. A platform admin reaches a customer's event ONLY through an explicit support
   session - never by virtue of being an admin, and never a second event at once.
2. Every event, however it was created, queues exactly one assistant intro to
   its owner - because they all funnel through entitlement redemption.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from tests.conftest import auth_header, make_event


@pytest.fixture()
def users_table(db):
    """core's schema has no aub `users` table; support lookups read it. Create a
    minimal stand-in so the real SQL runs, and reset the module's
    'tables missing' latch that earlier tests may have tripped."""
    from app import support

    db.execute(text(
        "CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY, role VARCHAR(30))"
    ))
    db.commit()
    support._unavailable = False
    yield
    db.execute(text("DELETE FROM admin_support_sessions"))
    db.execute(text("DELETE FROM users"))
    db.commit()


def _make_admin(db, admin_id) -> None:
    db.execute(text("INSERT INTO users (id, role) VALUES (:i, 'admin') ON CONFLICT (id) DO NOTHING"),
               {"i": str(admin_id)})
    db.commit()


# --- support sessions ------------------------------------------------------

def test_admin_cannot_read_someone_elses_event_without_a_session(client, db, users_table):
    admin_id, owner_id = uuid.uuid4(), uuid.uuid4()
    _make_admin(db, admin_id)
    event_id = make_event(db, owner_id)

    r = client.get(f"/events/{event_id}", headers=auth_header(admin_id))
    assert r.status_code == 404, "admin role alone must not grant cross-tenant access"


def test_support_session_grants_access_to_that_one_event(client, db, users_table):
    admin_id, owner_id = uuid.uuid4(), uuid.uuid4()
    _make_admin(db, admin_id)
    event_id = make_event(db, owner_id)
    other_event_id = make_event(db, owner_id)

    r = client.post("/admin/support/enter", json={"event_id": str(event_id)},
                    headers=auth_header(admin_id))
    assert r.status_code == 200
    assert r.json()["session"]["event_id"] == str(event_id)

    assert client.get(f"/events/{event_id}", headers=auth_header(admin_id)).status_code == 200
    # Scoped: the session covers exactly the event it named.
    assert client.get(f"/events/{other_event_id}", headers=auth_header(admin_id)).status_code == 404


def test_entering_a_second_event_replaces_the_first(client, db, users_table):
    admin_id, owner_id = uuid.uuid4(), uuid.uuid4()
    _make_admin(db, admin_id)
    first, second = make_event(db, owner_id), make_event(db, owner_id)

    client.post("/admin/support/enter", json={"event_id": str(first)}, headers=auth_header(admin_id))
    client.post("/admin/support/enter", json={"event_id": str(second)}, headers=auth_header(admin_id))

    assert client.get(f"/events/{second}", headers=auth_header(admin_id)).status_code == 200
    assert client.get(f"/events/{first}", headers=auth_header(admin_id)).status_code == 404, \
        "access must not accumulate across events"


def test_exit_revokes_access(client, db, users_table):
    admin_id, owner_id = uuid.uuid4(), uuid.uuid4()
    _make_admin(db, admin_id)
    event_id = make_event(db, owner_id)

    client.post("/admin/support/enter", json={"event_id": str(event_id)}, headers=auth_header(admin_id))
    assert client.get(f"/events/{event_id}", headers=auth_header(admin_id)).status_code == 200

    assert client.post("/admin/support/exit", headers=auth_header(admin_id)).status_code == 200
    assert client.get(f"/events/{event_id}", headers=auth_header(admin_id)).status_code == 404


def test_supported_event_appears_in_the_admins_event_list(client, db, users_table):
    """The dashboard's switcher selects from /events, so the supported event has
    to be listed - otherwise entering it bounces straight back out."""
    admin_id, owner_id = uuid.uuid4(), uuid.uuid4()
    _make_admin(db, admin_id)
    event_id = make_event(db, owner_id)

    listed = client.get("/events", headers=auth_header(admin_id)).json()
    assert [e["id"] for e in listed] == []

    client.post("/admin/support/enter", json={"event_id": str(event_id)}, headers=auth_header(admin_id))
    listed = client.get("/events", headers=auth_header(admin_id)).json()
    assert [e["id"] for e in listed] == [str(event_id)]


def test_non_admin_cannot_open_a_support_session(client, db, users_table):
    user_id, owner_id = uuid.uuid4(), uuid.uuid4()
    db.execute(text("INSERT INTO users (id, role) VALUES (:i, 'user')"), {"i": str(user_id)})
    db.commit()
    event_id = make_event(db, owner_id)

    r = client.post("/admin/support/enter", json={"event_id": str(event_id)},
                    headers=auth_header(user_id))
    assert r.status_code == 403
    assert client.get(f"/events/{event_id}", headers=auth_header(user_id)).status_code == 404


def test_expired_session_grants_nothing(client, db, users_table):
    admin_id, owner_id = uuid.uuid4(), uuid.uuid4()
    _make_admin(db, admin_id)
    event_id = make_event(db, owner_id)
    client.post("/admin/support/enter", json={"event_id": str(event_id)}, headers=auth_header(admin_id))

    db.execute(text("UPDATE admin_support_sessions SET expires_at = NOW() - INTERVAL '1 minute'"))
    db.commit()

    assert client.get(f"/events/{event_id}", headers=auth_header(admin_id)).status_code == 404
    assert client.get("/admin/support/session", headers=auth_header(admin_id)).json()["session"] is None


def test_support_session_is_audited(client, db, users_table):
    admin_id, owner_id = uuid.uuid4(), uuid.uuid4()
    _make_admin(db, admin_id)
    event_id = make_event(db, owner_id)

    client.post("/admin/support/enter", json={"event_id": str(event_id)}, headers=auth_header(admin_id))
    client.post("/admin/support/exit", headers=auth_header(admin_id))

    actions = [r[0] for r in db.execute(text(
        "SELECT action FROM audit_log WHERE entity_id = :e ORDER BY occurred_at"), {"e": str(event_id)}
    ).all()]
    assert "admin.support.enter" in actions and "admin.support.exit" in actions


# --- assistant intro on every creation path --------------------------------

def _intro_rows(db, event_id):
    return db.execute(text(
        "SELECT recipient_phone, params FROM owner_notifications "
        "WHERE kind = 'assistant_intro' AND event_id = :e"), {"e": str(event_id)}).mappings().all()


@pytest.fixture()
def owner_directory(monkeypatch):
    """Stand in for aub's user directory (unreachable in tests)."""
    from app import user_directory

    calls = {}

    def _resolve(ids):
        calls["ids"] = [str(i) for i in ids]
        return {str(i): {"first_name": "דנה", "last_name": "כהן", "phone": "+972500000009"} for i in ids}

    monkeypatch.setattr(user_directory, "resolve_users_by_ids", _resolve)
    return calls


@pytest.mark.parametrize("creator", ["self_service", "redeem_link"])
def test_every_creation_path_queues_one_assistant_intro(client, db, owner_directory, creator):
    """Free self-service and a redemption/gift link are two different front
    doors; both must introduce the assistant, because both redeem an
    entitlement - the single event-construction path."""
    from app import entitlement_service
    from shared.domain.enums import EntitlementSource

    user_id = uuid.uuid4()
    if creator == "self_service":
        r = client.post("/events", json={"terms_version": "2026-11-01", "name": "חתונה", "subjects": {"p1": "נועה", "p2": "יונתן"}}, headers=auth_header(user_id))
        assert r.status_code == 201
        event_id = r.json()["id"]
    else:
        ent = entitlement_service.issue(db, source=EntitlementSource.PROMOTION, plan_id="starter")
        r = client.post(f"/redeem/{ent.code}", json={"terms_version": "2026-11-01", "name": "בר מצווה", "subjects": {"honoree": "דניאל"}}, headers=auth_header(user_id))
        assert r.status_code == 201
        event_id = r.json()["id"]

    rows = _intro_rows(db, event_id)
    assert len(rows) == 1, "exactly one intro per event"
    assert rows[0]["recipient_phone"] == "+972500000009"
    assert rows[0]["params"]["1"] == "דנה"


def test_assistant_intro_is_deduped_per_event(client, db, owner_directory):
    """A second writer (aub's payment provisioning) shares the dedupe key, so a
    replay can never message the owner twice."""
    from app.models.models import Event
    from app.notifications import queue_assistant_intro

    user_id = uuid.uuid4()
    event_id = make_event(db, user_id)
    event = db.query(Event).filter(Event.id == str(event_id)).first()

    assert queue_assistant_intro(db, event=event, owner_user_id=user_id) is True
    assert queue_assistant_intro(db, event=event, owner_user_id=user_id) is False
    assert len(_intro_rows(db, event_id)) == 1


def test_event_creation_survives_a_dead_user_directory(client, db, monkeypatch):
    """No phone, no intro - but never a failed event creation."""
    from app import user_directory

    monkeypatch.setattr(user_directory, "resolve_users_by_ids", lambda ids: {})
    r = client.post("/events", json={"terms_version": "2026-11-01", "name": "אירוע", "subjects": {"p1": "נועה", "p2": "יונתן"}}, headers=auth_header(uuid.uuid4()))
    assert r.status_code == 201
    assert _intro_rows(db, r.json()["id"]) == []
