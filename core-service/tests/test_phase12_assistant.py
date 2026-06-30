"""Phase 12 - AI assistant infrastructure tests."""
from __future__ import annotations

import uuid

import pytest

from app.assistant import (
    link_identity, verify_identity, authenticate_sender,
    open_session, assistant_dispatch, AssistantAuthError,
)
from app.ai_tools import ToolDenied
from app.models.models import AuditLog
from shared.domain.roles import Role
from tests.conftest import make_account_with_event, make_guest


PHONE = "+972500000099"


def test_unverified_sender_cannot_open_session(db):
    owner = uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    # Link exists but is NOT verified.
    link_identity(db, PHONE, owner, verified=False)
    assert authenticate_sender(db, PHONE) is None
    with pytest.raises(AssistantAuthError):
        open_session(db, PHONE, event_id)


def test_unknown_phone_denied(db):
    owner = uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    with pytest.raises(AssistantAuthError):
        open_session(db, "+972500000000", event_id)


def test_verified_sender_opens_scoped_session(db):
    owner = uuid.uuid4()
    account_id, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    link_identity(db, PHONE, owner, verified=True)
    session = open_session(db, PHONE, event_id)
    assert session.user_id == owner
    assert str(session.account_id) == str(account_id)
    assert str(session.event_id) == str(event_id)


def test_user_without_role_denied(db):
    owner = uuid.uuid4()
    stranger = uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    # stranger is verified-linked but has NO membership on this event's account.
    link_identity(db, "+972500000088", stranger, verified=True)
    with pytest.raises(AssistantAuthError):
        open_session(db, "+972500000088", event_id)


def test_session_tool_dispatch_enforces_rbac_and_audits(db):
    viewer = uuid.uuid4()
    _, event_id = make_account_with_event(db, {viewer: Role.VIEWER.value})
    make_guest(db, event_id)
    link_identity(db, PHONE, viewer, verified=True)
    session = open_session(db, PHONE, event_id)

    # Viewer can read via the assistant...
    res = assistant_dispatch(db, session, "SearchGuest", {})
    assert res["status"] == "ok"
    # ...but cannot write.
    with pytest.raises(ToolDenied):
        assistant_dispatch(db, session, "AddGuest", {"name": "X", "phone": "+972500000077"})

    # Tool calls were audited as the assistant actor.
    rows = db.query(AuditLog).filter(AuditLog.action == "tool:SearchGuest").all()
    assert rows and rows[0].actor_type == "assistant"


def test_expired_session_rejected(db):
    import datetime as dt
    owner = uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    link_identity(db, PHONE, owner, verified=True)
    session = open_session(db, PHONE, event_id)
    # Force expiry.
    session.expires_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1)
    db.commit()
    with pytest.raises(AssistantAuthError):
        assistant_dispatch(db, session, "EventStats", {})
