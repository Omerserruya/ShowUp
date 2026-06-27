"""Shared pytest fixtures for core-service.

Runs against a real Postgres (provided by tooling/test/run.sh via DATABASE_URL).
Importing the app creates the schema on startup; each test gets a clean DB.
Auth is exercised for real: we mint HS256 JWTs that flow through AuthMiddleware.
"""
from __future__ import annotations

import os
import uuid

import jwt
import pytest
from fastapi.testclient import TestClient

# AuthMiddleware and token minting must agree on the secret.
os.environ.setdefault("JWT_SECRET", "test-secret")
# Ensure the capacity check never reaches a real aub-service during tests.
os.environ.setdefault("AUB_SERVICE_URL", "http://disabled.invalid")


@pytest.fixture(scope="session")
def app_module():
    # Import is deferred until DATABASE_URL is present; create_app() builds the schema.
    from app import main as main_module
    return main_module


@pytest.fixture()
def client(app_module) -> TestClient:
    return TestClient(app_module.app)


@pytest.fixture()
def db(app_module):
    from app.db import SessionLocal
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def _clean_db(app_module):
    """Truncate domain tables before each test for isolation."""
    from app.db import engine
    from sqlalchemy import text
    with engine.begin() as conn:
        # events cascades to guests/campaigns/custom-values/timeline/usage via FK CASCADE.
        # audit_log has no FK, so truncate it explicitly for count-sensitive tests.
        conn.execute(text("TRUNCATE TABLE events, campaigns, guests, audit_log RESTART IDENTITY CASCADE"))
    yield


def auth_header(user_id) -> dict:
    token = jwt.encode({"user_id": str(user_id)}, os.environ["JWT_SECRET"], algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}


def make_event(db, owner_id) -> "uuid.UUID":
    from app.models.models import Event
    event = Event(owners=[str(owner_id)], inviters=[], name="Test Event", active=True)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event.id


def make_guest(db, event_id, phone="+972500000001") -> "uuid.UUID":
    from app.models.models import Guest
    guest = Guest(event_id=str(event_id), name="Guest", phone=phone, status="invited", import_count=1)
    db.add(guest)
    db.commit()
    db.refresh(guest)
    return guest.id


def make_campaign(db, event_id) -> "uuid.UUID":
    from app.models.models import Campaign
    campaign = Campaign(event_id=str(event_id), name="Round 1", template="event_no_pic",
                        channel="whatsapp", status="pending")
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return campaign.id


def make_account_with_event(db, members: dict):
    """Create an account, memberships (members = {user_id: role_value}), and an
    account-scoped event. Returns (account_id, event_id)."""
    from app.models.models import Account, Membership, Event
    account = Account(name="Acct")
    db.add(account)
    db.flush()
    for uid, role in members.items():
        db.add(Membership(account_id=account.id, user_id=uid, role=role, status="active"))
    event = Event(owners=[], inviters=[], name="Acct Event", active=True, account_id=account.id)
    db.add(event)
    db.commit()
    db.refresh(event)
    return account.id, event.id
