"""Phase 11 - AI tool layer tests (RBAC + ownership + audit, no AI)."""
from __future__ import annotations

import uuid

import pytest

from app.ai_tools import dispatch_tool, ToolContext, ToolDenied, ToolNotFound, list_tools
from app.models.models import AuditLog
from shared.domain.roles import Role
from shared.domain.enums import ActorType
from tests.conftest import make_account_with_event, make_guest


def _ctx(db, user_id, event_id):
    return ToolContext(db=db, user_id=user_id, event_id=event_id, actor_type=ActorType.ASSISTANT)


def test_registry_has_expected_tools():
    names = {t["name"] for t in list_tools()}
    assert {"SearchGuest", "AddGuest", "UpdateGuest", "EventStats", "ExportGuests"} <= names


def test_viewer_can_search_not_add(db):
    viewer = uuid.uuid4()
    _, event_id = make_account_with_event(db, {viewer: Role.VIEWER.value})
    make_guest(db, event_id)
    ctx = _ctx(db, viewer, event_id)

    res = dispatch_tool(ctx, "SearchGuest", {})
    assert res["status"] == "ok" and len(res["result"]) == 1

    with pytest.raises(ToolDenied):
        dispatch_tool(ctx, "AddGuest", {"name": "New", "phone": "+972500000009"})


def test_coordinator_can_add_and_update(db):
    coord = uuid.uuid4()
    _, event_id = make_account_with_event(db, {coord: Role.GUEST_COORDINATOR.value})
    ctx = _ctx(db, coord, event_id)

    added = dispatch_tool(ctx, "AddGuest", {"name": "Dana", "phone": "+972500000010"})
    gid = added["result"]["id"]
    upd = dispatch_tool(ctx, "UpdateGuest", {"guest_id": gid, "status": "confirmed"})
    assert upd["result"]["status"] == "confirmed"


def test_non_member_denied(db):
    member = uuid.uuid4()
    outsider = uuid.uuid4()
    _, event_id = make_account_with_event(db, {member: Role.OWNER.value})
    with pytest.raises(ToolDenied):
        dispatch_tool(_ctx(db, outsider, event_id), "SearchGuest", {})


def test_unknown_tool(db):
    owner = uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    with pytest.raises(ToolNotFound):
        dispatch_tool(_ctx(db, owner, event_id), "DropDatabase", {})


def test_cross_event_update_denied(db):
    owner = uuid.uuid4()
    _, event_a = make_account_with_event(db, {owner: Role.OWNER.value})
    _, event_b = make_account_with_event(db, {owner: Role.OWNER.value})
    guest_b = make_guest(db, event_b)
    # ctx scoped to event_a, but guest belongs to event_b -> denied
    with pytest.raises(ToolDenied):
        dispatch_tool(_ctx(db, owner, event_a), "UpdateGuest", {"guest_id": str(guest_b), "status": "confirmed"})


def test_event_stats_tool(db):
    owner = uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    from app.models.models import Guest
    db.add(Guest(event_id=str(event_id), name="A", phone="+972500000021", status="confirmed", import_count=1))
    db.add(Guest(event_id=str(event_id), name="B", phone="+972500000022", status="invited", import_count=1))
    db.commit()
    res = dispatch_tool(_ctx(db, owner, event_id), "EventStats", {})["result"]
    assert res["total_guests"] == 2 and res["confirmed"] == 1 and res["no_response"] == 1


def test_tool_calls_are_audited(db):
    owner = uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    dispatch_tool(_ctx(db, owner, event_id), "EventStats", {})
    rows = db.query(AuditLog).filter(AuditLog.action == "tool:EventStats").all()
    assert len(rows) == 1
    assert rows[0].actor_type == "assistant"
    assert rows[0].data["status"] == "ok"
