"""Admin Template Studio API (app/routers/admin_templates.py).

Locks: admin-only; CRUD of JSON docs with identity validation; versioning on
edit-after-submit; group/archive/delete rules; validate/preview/variables;
submit (dry-run, simulated, create vs Meta-edit vs versioned `_vN` name) with
the Meta client MOCKED; sync promotes the approved snapshot to `live`; approved
guest-stage templates become `custom__<key>` in /catalog and pass the campaign
deliverability gate; export/import never overwrites a submitted template;
duplicate from catalog/system; the flow-builder picker feed.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import text

from tests.conftest import auth_header

ADMIN = uuid.uuid4()


class FakeResult:
    def __init__(self, ok=True, meta_id=None, status="pending", reason=None, simulated=False):
        self.ok, self.meta_id, self.meta_status = ok, meta_id, status
        self.rejection_reason, self.error, self.simulated = reason, reason, simulated
        self.category = "MARKETING"


class FakeMeta:
    """Stands in for MetaTemplateClient - never touches the network."""
    calls: list = []
    statuses: dict = {}
    create_result = None

    def __init__(self):
        self.configured = True

    def upload_header_handle(self, url):
        FakeMeta.calls.append(("upload", url))
        return "HANDLE-1"

    def create_template(self, payload, dry_run=False):
        FakeMeta.calls.append(("create", payload))
        return FakeMeta.create_result or FakeResult(meta_id=f"id-{payload['name']}")

    def edit_template(self, meta_id, payload, dry_run=False):
        FakeMeta.calls.append(("edit", meta_id, payload))
        return FakeResult(meta_id=meta_id)

    def fetch_status(self, name):
        st = FakeMeta.statuses.get(name, "PENDING")
        return FakeResult(meta_id=f"id-{name}", status=st.lower(),
                          reason="INVALID_FORMAT" if st == "REJECTED" else None)


@pytest.fixture()
def admin(app_module, monkeypatch):
    from shared.auth.admin import get_admin_user_id
    from app.routers import admin_templates
    app_module.app.dependency_overrides[get_admin_user_id] = lambda: ADMIN
    from app.db import engine
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM custom_templates"))
    FakeMeta.calls, FakeMeta.statuses, FakeMeta.create_result = [], {}, None
    monkeypatch.setattr(admin_templates, "MetaTemplateClient", FakeMeta)
    yield auth_header(ADMIN)
    app_module.app.dependency_overrides.pop(get_admin_user_id, None)


def _doc(**over):
    d = {"name": "garden_invite", "title": "הזמנה לגן", "group": "invitation", "category": "MARKETING",
         "language": "he", "header": {"type": "none"},
         "body": "היי {{guest_name}}, מוזמנים ל{{event_name}} ב{{event_date}}. נשמח לראותכם!",
         "footer": "ShowUp",
         "buttons": [{"type": "QUICK_REPLY", "text": "מגיעים!", "action": "rsvp_accepted"}]}
    d.update(over)
    return d


def _create(client, h, **over):
    r = client.post("/admin/templates", json={"doc": _doc(**over)}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _approve(client, h, key="garden_invite", name=None):
    FakeMeta.statuses[name or key] = "APPROVED"
    r = client.post(f"/admin/templates/{key}/sync", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def test_requires_auth(client):
    assert client.get("/admin/templates").status_code == 401


def test_crud_versioning_group_archive_delete(client, admin, db):
    v = _create(client, admin)
    assert v["key"] == "garden_invite" and v["meta_status"] == "draft" and v["ref"] == "custom__garden_invite"
    assert v["validation"]["errors"] == [] and [p["var"] for p in v["params"]] == ["guest_name", "event_name", "event_date"]
    # identity errors block storing; a taken / catalog name is refused
    r = client.post("/admin/templates", json={"doc": _doc(name="Bad Name")}, headers=admin)
    assert r.status_code == 422 and r.json()["detail"]["errors"][0]["field"] == "name"
    assert client.post("/admin/templates", json={"doc": _doc()}, headers=admin).status_code == 422
    assert client.post("/admin/templates", json={"doc": _doc(name="event_no_pic")}, headers=admin).status_code == 422
    # a draft may be saved with content issues (reported, not blocking)
    bad = _create(client, admin, name="half_done", body="{{guest_name}}")
    assert {e["code"] for e in bad["validation"]["errors"]} >= {"var_at_start", "var_at_end"}

    lst = client.get("/admin/templates", headers=admin).json()
    assert {t["key"] for t in lst["templates"]} == {"garden_invite", "half_done"}
    assert lst["catalog"] and any(c["key"] == "event_no_pic" for c in lst["catalog"])
    assert {s["key"] for s in lst["system"]} >= {"team_invite"}
    assert [g["id"] for g in lst["groups"]][-2:] == ["flow", "host"]

    # rename allowed before first submission
    r = client.put("/admin/templates/half_done", json={"doc": _doc(name="half_done_2", title="אחר")}, headers=admin)
    assert r.status_code == 200 and r.json()["key"] == "half_done_2"
    assert client.get("/admin/templates/half_done", headers=admin).status_code == 404

    r = client.post("/admin/templates/garden_invite/group", json={"group": "flow"}, headers=admin)
    assert r.json()["group"] == "flow"
    assert client.post("/admin/templates/garden_invite/group", json={"group": "x"}, headers=admin).status_code == 422
    r = client.post("/admin/templates/garden_invite/archive", json={"archived": True}, headers=admin)
    assert r.json()["archived"] is True
    assert "garden_invite" not in {t["key"] for t in
                                   client.get("/admin/templates?include_archived=false", headers=admin).json()["templates"]}
    assert client.delete("/admin/templates/half_done_2", headers=admin).status_code == 200

    actions = {row[0] for row in db.execute(text(
        "SELECT action FROM audit_log WHERE entity_type = 'custom_template'")).fetchall()}
    assert {"custom_template.create", "custom_template.update", "custom_template.group",
            "custom_template.archive", "custom_template.delete"} <= actions


def test_validate_preview_variables(client, admin):
    r = client.post("/admin/templates/validate", json={"doc": _doc(body="שלום {{nope}} וברוכים הבאים.")}, headers=admin)
    assert r.json()["valid"] is False and r.json()["errors"][0]["code"] == "unknown_var"
    r = client.post("/admin/templates/validate", json={"doc": _doc(name="", title="Summer Party")}, headers=admin)
    assert r.json()["suggested_name"] == "summer_party"

    r = client.post("/admin/templates/preview", json={"doc": _doc()}, headers=admin)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["rendered"]["body"].startswith("היי דוד כהן, מוזמנים להחתונה שלנו")
    assert out["meta_create_payload"]["components"][0]["text"] == "היי {{1}}, מוזמנים ל{{2}} ב{{3}}. נשמח לראותכם!"
    assert out["whatsapp_send_payload"]["template"] == "garden_invite"

    v = client.get("/admin/templates/variables", headers=admin).json()
    names = {x["name"] for x in v["variables"]}
    assert {"guest_name", "event_date", "invitation_link"} <= names
    assert {u["name"] for u in v["url_vars"]} == {"invitation_link", "rsvp_link", "nav_link", "gift_link", "calendar_link"}


def test_submit_sync_live_and_versioned_resubmit(client, admin, db):
    _create(client, admin)
    # dry run: exact payload, nothing written, Meta not called
    r = client.post("/admin/templates/garden_invite/submit", json={"dry_run": True}, headers=admin)
    assert r.status_code == 200 and r.json()["mode"] == "create" and r.json()["meta_name"] == "garden_invite"
    assert r.json()["meta_payload"]["category"] == "MARKETING" and FakeMeta.calls == []
    assert client.get("/admin/templates/garden_invite", headers=admin).json()["meta_status"] == "draft"

    r = client.post("/admin/templates/garden_invite/submit", headers=admin)
    assert r.status_code == 200, r.text
    t = r.json()["template"]
    assert t["meta_status"] == "pending" and t["meta_name"] == "garden_invite" and t["meta_id"] == "id-garden_invite"
    assert FakeMeta.calls[0][0] == "create"
    assert client.post("/admin/templates/garden_invite/submit", headers=admin).status_code == 409   # pending
    # submitted -> cannot delete / rename
    assert client.delete("/admin/templates/garden_invite", headers=admin).status_code == 409
    assert client.put("/admin/templates/garden_invite", json={"doc": _doc(name="other_name")},
                      headers=admin).status_code == 409

    t = _approve(client, admin)
    assert t["meta_status"] == "approved" and t["deliverable"] is True and t["live"]["meta_name"] == "garden_invite"
    assert t["usable_in"] == ["campaigns", "flow"]
    assert client.post("/admin/templates/garden_invite/submit", headers=admin).status_code == 409   # no changes

    # edit after approval -> new draft version; live keeps delivering v1
    r = client.put("/admin/templates/garden_invite",
                   json={"doc": _doc(body="שלום {{guest_name}}, מחכים לכם ב{{event_name}}!")}, headers=admin)
    t = r.json()
    assert t["version"] == 2 and t["has_unsubmitted_changes"] is True and t["deliverable"] is True
    r = client.put("/admin/templates/garden_invite",
                   json={"doc": _doc(body="שלום {{guest_name}}, מחכים לכם מאוד ב{{event_name}}!")}, headers=admin)
    assert r.json()["version"] == 2   # still the same draft version

    r = client.post("/admin/templates/garden_invite/submit", headers=admin)
    assert r.json()["meta_name"] == "garden_invite_v2" and r.json()["mode"] == "create"
    t = r.json()["template"]
    assert t["meta_status"] == "pending" and t["live"]["meta_name"] == "garden_invite" and t["deliverable"]

    FakeMeta.statuses["garden_invite"] = "APPROVED"
    t = _approve(client, admin, name="garden_invite_v2")
    assert t["live"]["meta_name"] == "garden_invite_v2" and t["live"]["version"] == 2

    # bulk sync covers it too
    r = client.post("/admin/templates/sync", headers=admin)
    assert r.status_code == 200 and r.json()["synced"] == 1


def test_rejected_uses_meta_edit_endpoint(client, admin):
    _create(client, admin, name="rej_tpl")
    client.post("/admin/templates/rej_tpl/submit", headers=admin)
    FakeMeta.statuses["rej_tpl"] = "REJECTED"
    t = client.post("/admin/templates/rej_tpl/sync", headers=admin).json()
    assert t["meta_status"] == "rejected" and t["rejection_reason"] == "INVALID_FORMAT" and not t["deliverable"]
    client.put("/admin/templates/rej_tpl", json={"doc": _doc(name="rej_tpl", footer="")}, headers=admin)
    r = client.post("/admin/templates/rej_tpl/submit", headers=admin)
    assert r.json()["mode"] == "edit" and r.json()["meta_name"] == "rej_tpl"
    assert FakeMeta.calls[-1][0] == "edit" and FakeMeta.calls[-1][1] == "id-rej_tpl"
    assert "components" in FakeMeta.calls[-1][2]
    # a Meta-side create failure is recorded as rejected with the reason
    _create(client, admin, name="fails_tpl")
    FakeMeta.create_result = FakeResult(ok=False, status="rejected", reason="bad body")
    r = client.post("/admin/templates/fails_tpl/submit", headers=admin)
    assert r.json()["ok"] is False and r.json()["template"]["rejection_reason"] == "bad body"


def test_image_header_uploads_handle(client, admin):
    _create(client, admin, name="pic_tpl", header={"type": "image", "url": "https://cdn.x/a.jpg"})
    client.post("/admin/templates/pic_tpl/submit", headers=admin)
    assert ("upload", "https://cdn.x/a.jpg") in FakeMeta.calls
    created = [c for c in FakeMeta.calls if c[0] == "create"][-1][1]
    assert created["components"][0]["example"]["header_handle"] == ["HANDLE-1"]


def test_catalog_and_campaign_gate(client, admin, db):
    from app.routers.campaigns import _require_deliverable_template
    _create(client, admin)
    # not approved -> not in catalog, rejected by the gate
    cat = client.get("/catalog").json()
    assert not any(t["id"] == "custom__garden_invite" for t in cat["templates"])
    with pytest.raises(HTTPException) as e:
        _require_deliverable_template(db, "custom__garden_invite", None, event_type="wedding")
    assert e.value.status_code == 400
    with pytest.raises(HTTPException):
        _require_deliverable_template(db, "custom__missing", None)

    client.post("/admin/templates/garden_invite/submit", headers=admin)
    _approve(client, admin)
    cat = client.get("/catalog").json()
    dto = next(t for t in cat["templates"] if t["id"] == "custom__garden_invite")
    assert dto["sendable"] is True and dto["flow_stage"] == "invitation" and dto["lifecycle"] == "approved"
    assert "wedding" in dto["sendable_event_types"] and dto["meta_template"] == "garden_invite"
    _require_deliverable_template(db, "custom__garden_invite", None, event_type="wedding")   # passes
    # catalog entries are untouched by the extras
    assert sum(1 for t in cat["templates"] if t.get("source") == "custom") == 1
    # crud lookup (stage derivation) understands the ref
    from app.crud.campaign import campaign_stage
    assert campaign_stage(db, "custom__garden_invite") == "invitation"

    # flow-group template: approved but not a campaign template
    client.post("/admin/templates/garden_invite/group", json={"group": "flow"}, headers=admin)
    assert not any(t["id"] == "custom__garden_invite" for t in client.get("/catalog").json()["templates"])
    with pytest.raises(HTTPException):
        _require_deliverable_template(db, "custom__garden_invite", None)
    feed = client.get("/admin/templates/approved?group=flow", headers=admin).json()["templates"]
    assert feed[0]["name"] == "garden_invite" and feed[0]["language"] == "he"
    assert [p["suggested"] for p in feed[0]["params"]] == ["{guest_name}", "{event_name}", "{event_date}"]
    assert feed[0]["body_params_only"] is True
    # archived -> out of pickers
    client.post("/admin/templates/garden_invite/archive", json={"archived": True}, headers=admin)
    assert client.get("/admin/templates/approved", headers=admin).json()["templates"] == []


def test_export_import_conflicts(client, admin):
    _create(client, admin)
    client.post("/admin/templates/garden_invite/submit", headers=admin)
    _create(client, admin, name="draft_one")
    r = client.get("/admin/templates/export", headers=admin)
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    docs = r.json()
    assert [d["name"] for d in docs] == ["draft_one", "garden_invite"]

    docs[0]["title"] = "עודכן"
    docs[1]["title"] = "ניסיון דריסה"
    new = _doc(name="brand_new")
    payload = docs + [new, {"name": "Bad!"}, dict(new)]
    r = client.post("/admin/templates/import", json={"templates": payload, "dry_run": True}, headers=admin)
    assert r.json()["counts"] == {"created": 1, "updated": 1, "unchanged": 0, "conflict": 1, "error": 2}
    assert client.get("/admin/templates/brand_new", headers=admin).status_code == 404   # dry run

    r = client.post("/admin/templates/import", json=payload, headers=admin)   # bare array
    assert r.json()["counts"]["created"] == 1 and r.json()["counts"]["conflict"] == 1
    assert client.get("/admin/templates/draft_one", headers=admin).json()["title"] == "עודכן"
    assert client.get("/admin/templates/garden_invite", headers=admin).json()["title"] == "הזמנה לגן"
    r = client.post("/admin/templates/import", json=[docs[0]], headers=admin)
    assert r.json()["counts"]["unchanged"] == 1


def test_duplicate_from_catalog_system_custom(client, admin):
    r = client.post("/admin/templates/duplicate", json={"source": "catalog", "source_key": "event_no_pic"},
                    headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["key"] == "event_no_pic_copy" and r.json()["meta_status"] == "draft"
    r = client.post("/admin/templates/duplicate", json={"source": "system", "source_key": "team_invite",
                                                        "name": "team_invite_alt"}, headers=admin)
    assert r.status_code == 200 and r.json()["group"] == "host"
    assert "{{param_1}}" in r.json()["doc"]["body"]
    r = client.post("/admin/templates/duplicate", json={"source": "custom", "source_key": "team_invite_alt",
                                                        "group": "flow"}, headers=admin)
    assert r.json()["group"] == "flow" and r.json()["title"].endswith("(עותק)")
    assert client.post("/admin/templates/duplicate", json={"source": "catalog", "source_key": "nope"},
                       headers=admin).status_code == 404


def test_meta_status_webhook_refreshes_custom_and_catalog(client, admin, db, monkeypatch):
    """Meta's message_template_status_update (forwarded by webhook-hendler) makes
    an approval live without anyone pressing "רענן"; internal secret required."""
    monkeypatch.setenv("INTERNAL_API_SECRET", "s3cret")
    _create(client, admin)
    assert client.post("/admin/templates/garden_invite/submit", json={}, headers=admin).status_code == 200
    FakeMeta.statuses["garden_invite"] = "APPROVED"
    url = "/internal/meta/template-status"
    assert client.post(url, json={"name": "garden_invite"}).status_code == 403
    r = client.post(url, json={"name": "garden_invite", "event": "APPROVED"}, headers={"X-Internal-Secret": "s3cret"})
    assert r.status_code == 200 and r.json()["updated"] == ["custom:garden_invite"], r.text
    v = client.get("/admin/templates/garden_invite", headers=admin).json()
    assert v["meta_status"] == "approved" and v["live"]["status"] == "approved"

    # a catalog template is matched by its published Meta name
    from shared.domain.messaging import published_name, select_templates
    t = next(t for t in select_templates("all") if t.key == "invitation_funny__wedding")
    FakeMeta.statuses[published_name(t)] = "REJECTED"
    r = client.post(url, json={"name": published_name(t)}, headers={"X-Internal-Secret": "s3cret"})
    assert r.json()["updated"] == ["catalog:invitation_funny__wedding"]
    st = db.execute(text("SELECT meta_status, rejection_reason FROM messaging_template_state "
                         "WHERE template_key = 'invitation_funny__wedding'")).first()
    assert st == ("rejected", "INVALID_FORMAT")
    assert client.post(url, json={"name": "nobody_knows_me"}, headers={"X-Internal-Secret": "s3cret"}).json() == {"updated": []}
