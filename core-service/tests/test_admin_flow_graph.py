"""Admin flow-graph API (app/routers/admin_flow_graph.py).

Locks: default graph per scope (with flow settings overlaid), validation 422
with per-node/edge errors, versioning + 409 on a stale expected_version,
enable flag (created disabled), versions/revert, validate, simulate (no DB
writes), meta, audit rows, admin-only.
"""
from __future__ import annotations

import copy
import uuid

import pytest
from sqlalchemy import text

from tests.conftest import auth_header, make_event

ADMIN = uuid.uuid4()


@pytest.fixture()
def admin(app_module):
    from shared.auth.admin import get_admin_user_id
    app_module.app.dependency_overrides[get_admin_user_id] = lambda: ADMIN
    from app.db import engine
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM flow_graphs"))
        conn.execute(text("DELETE FROM conversation_flow_configs"))
    yield auth_header(ADMIN)
    app_module.app.dependency_overrides.pop(get_admin_user_id, None)


def _node(g, nid):
    return next(n for n in g["nodes"] if n["id"] == nid)


def test_requires_auth(client):
    # (the admin-role lookup itself is shared/auth/admin.py, against aub's users table)
    assert client.get("/admin/flow-graph").status_code == 401


def test_default_scope_and_overlay(client, admin, db):
    r = client.get("/admin/flow-graph/global/default", headers=admin)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["is_default"] is True and body["version"] is None and body["enabled"] is False
    assert body["validation"] == {"errors": [], "warnings": []}
    assert body["live"] is None
    # flow settings (texts) overlay the default graph of the scope
    db.execute(text("INSERT INTO conversation_flow_configs (scope, scope_key, config, version, is_active) VALUES "
                    "('event_type', 'wedding', CAST(:c AS jsonb), 1, true)"),
               {"c": '{"after_decline": {"text": "חבל מאוד"}}'})
    db.commit()
    g = client.get("/admin/flow-graph/event_type/wedding", headers=admin).json()["graph"]
    assert _node(g, "rsvp_decline")["text"] == "חבל מאוד"
    assert client.get("/admin/flow-graph/event_type/nope", headers=admin).status_code == 404

    lst = client.get("/admin/flow-graph", headers=admin).json()
    assert lst["scopes"][0]["scope"] == "global" and lst["scopes"][0]["has_graph"] is False


def test_save_versions_conflict_enable_revert(client, admin, db):
    base = client.get("/admin/flow-graph/global/default", headers=admin).json()["graph"]
    bad = copy.deepcopy(base)
    _node(bad, "rsvp_done")["buttons"][0]["label"] = "x" * 30
    bad["edges"].append({"id": "e_x", "from": "rsvp_done", "to": "ghost", "when": {"kind": "any_text"}})
    r = client.put("/admin/flow-graph/global/default", json={"graph": bad, "expected_version": None}, headers=admin)
    assert r.status_code == 422
    errs = r.json()["detail"]["errors"]
    assert any(e.get("node_id") == "rsvp_done" and e["code"] == "too_long" for e in errs)
    assert any(e.get("edge_id") == "e_x" and e["code"] == "missing_node" for e in errs)

    g = copy.deepcopy(base)
    _node(g, "rsvp_count")["text"] = "כמה תהיו, {guest_name}?"
    r = client.put("/admin/flow-graph/global/default", json={"graph": g, "expected_version": None, "note": "v1"},
                   headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["version"] == 1 and r.json()["enabled"] is False and r.json()["is_default"] is False
    # never-saved expectation is now stale
    r = client.put("/admin/flow-graph/global/default", json={"graph": g, "expected_version": None}, headers=admin)
    assert r.status_code == 409
    r = client.put("/admin/flow-graph/global/default", json={"graph": g, "expected_version": 1}, headers=admin)
    assert r.status_code == 200 and r.json()["version"] == 2

    r = client.post("/admin/flow-graph/global/default/enable", json={"enabled": True}, headers=admin)
    assert r.status_code == 200 and r.json()["enabled"] is True
    assert r.json()["live"] == {"scope": "global", "scope_key": "default", "version": 2}
    # a new save keeps the scope enabled
    r = client.put("/admin/flow-graph/global/default", json={"graph": base, "expected_version": 2}, headers=admin)
    assert r.json()["version"] == 3 and r.json()["enabled"] is True

    versions = client.get("/admin/flow-graph/global/default/versions", headers=admin).json()
    assert isinstance(versions, list) and [v["version"] for v in versions] == [3, 2, 1]
    r = client.post("/admin/flow-graph/global/default/revert/1", headers=admin)
    assert r.status_code == 200 and r.json()["version"] == 4
    assert _node(r.json()["graph"], "rsvp_count")["text"] == "כמה תהיו, {guest_name}?"
    assert client.post("/admin/flow-graph/global/default/revert/99", headers=admin).status_code == 404

    r = client.post("/admin/flow-graph/global/default/enable", json={"enabled": False}, headers=admin)
    assert r.json()["enabled"] is False and r.json()["live"] is None

    actions = [row[0] for row in db.execute(text(
        "SELECT action FROM audit_log WHERE entity_type = 'flow_graph' ORDER BY occurred_at")).fetchall()]
    assert actions.count("flow_graph.save") == 3 and "flow_graph.enable" in actions \
        and "flow_graph.revert" in actions and "flow_graph.disable" in actions


def test_enable_never_saved_event_scope(client, admin, db):
    eid = make_event(db, uuid.uuid4())
    r = client.post(f"/admin/flow-graph/event/{eid}/enable", json={"enabled": True}, headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["version"] == 1 and r.json()["enabled"] is True
    assert r.json()["live"]["scope"] == "event"
    lst = client.get("/admin/flow-graph", headers=admin).json()["scopes"]
    assert any(s["scope"] == "event" and s["scope_key"] == str(eid) and s["enabled"] for s in lst)


def test_validate_simulate_meta(client, admin, db):
    base = client.get("/admin/flow-graph/global/default", headers=admin).json()["graph"]
    r = client.post("/admin/flow-graph/validate", json={"graph": base}, headers=admin)
    assert r.json() == {"valid": True, "errors": [], "warnings": []}
    before = db.execute(text("SELECT COUNT(*) FROM flow_graphs")).scalar()
    r = client.post("/admin/flow-graph/simulate", headers=admin, json={
        "graph": base, "event_type": "wedding",
        "inputs": [{"kind": "button", "button_id": "rsvp_accepted"}, {"kind": "text", "text": "3"},
                   {"kind": "text", "text": "כן"}, {"kind": "button", "button_id": "no_notes"}]})
    assert r.status_code == 200, r.text
    out = r.json()
    bots = [t for t in out["turns"] if t["from"] == "bot"]
    assert bots[0]["node_id"] == "rsvp_invite" and bots[-1]["node_id"] == "rsvp_done"
    assert {"id": "update", "label": "לעדכן הגעה"} in bots[-1]["buttons"]
    assert out["final_node"] == "rsvp_done"
    assert {a["type"] for a in out["actions"]} >= {"set_rsvp", "set_field", "store_answer"}
    assert db.execute(text("SELECT COUNT(*) FROM flow_graphs")).scalar() == before

    m = client.get("/admin/flow-graph/meta", headers=admin).json()
    assert {"node_types", "edge_kinds", "action_types", "fields", "variables", "entry_stages",
            "custom_fields", "limits"} <= set(m)
    assert {s["stage"] for s in m["entry_stages"]} == {"invitation", "reminder", "final_reminder", "default"}
