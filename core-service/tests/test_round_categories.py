"""Round categories: a round's category alone decides who receives it
(shared/domain/round_categories.py, app/round_categories.py)."""
from __future__ import annotations

import datetime as dt
import uuid

import pytest
from sqlalchemy import text

FUTURE = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=40)


def _event(db):
    from app import entitlement_service
    from shared.domain.enums import EntitlementSource
    event, _ = entitlement_service.issue_and_redeem(
        db, source=EntitlementSource.ADMIN, plan_id="pro", owner_user_id=uuid.uuid4(), account_id=None,
        event_fields={"name": "חתונה", "event_type": "wedding", "subjects": {"p1": "נועה", "p2": "יונתן"}})   # no date -> no default rounds
    from app.models.models import Guest
    for name, status in [("א", "invited"), ("ב", "maybe"), ("ג", "confirmed"), ("ד", "declined")]:
        db.add(Guest(event_id=event.id, name=name, phone=f"050{uuid.uuid4().int % 10**7:07d}", status=status))
    db.commit()
    return event


def _create(db, event, template, **kw):
    from app.crud import campaign as cc
    from app.schemas.schemas import CampaignCreate
    return cc.create_campaign(db, CampaignCreate(event_id=event.id, name="r", template=template,
                                                 channel="whatsapp", status="draft", **kw))


def test_builtin_category_decides_the_audience_and_wins_over_the_client(db):
    from app.audience import count_audience
    ev = _event(db)
    c = _create(db, ev, "event_remind", audience="everyone")       # client asks for everyone
    assert c.category_id == "final_reminder" and c.audience == "confirmed"
    assert count_audience(db, ev.id, c.audience, c.audience_filter) == 1


def test_custom_category_undecided_and_admin_edit_reaches_open_rounds(db):
    from app.audience import count_audience
    from app.crud import campaign as cc
    from app.round_categories import get_category, sync_category
    from app.schemas.schemas import CampaignUpdate
    ev = _event(db)
    cid = f"maybe_{uuid.uuid4().hex[:6]}"
    db.execute(text("INSERT INTO round_categories (id, base_stage, title, audience) "
                    "VALUES (:id, 'reminder', 'לא ענו + אולי', 'undecided')"), {"id": cid})
    db.commit()
    c = _create(db, ev, "reminder_friendly", category_id=cid)
    assert c.category_id == cid and count_audience(db, ev.id, c.audience, c.audience_filter) == 2  # invited + maybe
    # a category of another stage does not fit this template
    with pytest.raises(ValueError):
        _create(db, ev, "event_remind", category_id=cid)
    # client-sent audience on edit is ignored - the category still decides
    cc.update_campaign(db, c, CampaignUpdate(audience="everyone"))
    assert count_audience(db, ev.id, c.audience, c.audience_filter) == 2
    # admin changes the category -> the open round follows
    db.execute(text("UPDATE round_categories SET audience = 'maybe' WHERE id = :id"), {"id": cid})
    assert sync_category(db, get_category(db, cid)) == 1
    db.commit(); db.refresh(c)
    assert count_audience(db, ev.id, c.audience, c.audience_filter) == 1 and c.recipient_count == 1
    # changing the template to another stage moves it to that stage's category
    cc.update_campaign(db, c, CampaignUpdate(template="event_remind"))
    assert c.category_id == "final_reminder" and c.audience == "confirmed"


def test_tag_and_no_reminders_filters(db):
    from app.audience import count_audience
    from app.models.models import Account, Guest, GuestTag, Tag
    from shared.domain.round_categories import audience_pair
    ev = _event(db)
    acct = Account(name="Acct")
    db.add(acct); db.flush()
    g = db.query(Guest).filter(Guest.event_id == ev.id, Guest.name == "א").one()
    for name in ("vip", "no_reminders"):
        t = Tag(account_id=acct.id, name=name)
        db.add(t); db.flush()
        db.add(GuestTag(guest_id=g.id, tag_id=t.id))
    db.commit()
    assert count_audience(db, ev.id, *audience_pair("tag", "vip")) == 1
    assert count_audience(db, ev.id, *audience_pair("undecided")) == 1      # א skipped (no_reminders), ב counted
    with pytest.raises(ValueError):
        audience_pair("nope")


def test_owner_and_admin_endpoints(client, db):
    from tests.conftest import auth_header
    ev = _event(db)
    owner = ev.owners[0] if ev.owners else None
    r = client.get(f"/campaigns/categories?event_id={ev.id}", headers=auth_header(owner))
    assert r.status_code == 200, r.text
    by_id = {c["id"]: c for c in r.json()}
    assert by_id["final_reminder"]["recipients"] == 1 and by_id["final_reminder"]["audience_label"] == "אישרו הגעה"


def test_admin_creates_and_edits_categories(client, db, app_module):
    from shared.auth.admin import get_admin_user_id
    from tests.conftest import auth_header
    admin = uuid.uuid4()
    app_module.app.dependency_overrides[get_admin_user_id] = lambda: admin
    h = auth_header(admin)
    try:
        ev = _event(db)
        resp = client.get("/admin/messaging/round-categories", headers=h)
        assert resp.status_code == 200, resp.text
        lst = resp.json()
        assert {a["key"] for a in lst["audiences"]} >= {"everyone", "undecided", "confirmed", "tag"}
        bad = client.post("/admin/messaging/round-categories",
                          json={"title": "x", "base_stage": "reminder", "audience": "tag"}, headers=h)
        assert bad.status_code == 422
        r = client.post("/admin/messaging/round-categories",
                        json={"title": "רק אולי", "base_stage": "reminder", "audience": "maybe"}, headers=h)
        assert r.status_code == 201, r.text
        cid = r.json()["id"]
        c = _create(db, ev, "reminder_friendly", category_id=cid)
        assert c.recipient_count == 1
        r = client.put(f"/admin/messaging/round-categories/{cid}",
                       json={"title": "רק אולי", "base_stage": "reminder", "audience": "undecided"}, headers=h)
        assert r.status_code == 200 and r.json()["synced_rounds"] == 1
        db.refresh(c)
        assert c.recipient_count == 2
        builtin = client.put("/admin/messaging/round-categories/thank_you",
                             json={"title": "תודה", "audience": "confirmed", "archived": True}, headers=h)
        assert builtin.status_code == 422
    finally:
        app_module.app.dependency_overrides.pop(get_admin_user_id, None)


def test_moved_template_follows_its_category(client, db, app_module):
    """'האירוע ממש קרוב' asks guests to RSVP -> it sits in the further-RSVP
    category (seeded), so its rounds go to non-responders, not to the confirmed."""
    from app.default_rounds import default_template_for
    from app.routers.catalog import get_catalog
    from shared.auth.admin import get_admin_user_id
    from tests.conftest import auth_header
    ev = _event(db)
    c = _create(db, ev, "final_reminder_gentle__wedding")
    assert c.category_id == "reminder" and c.audience == "no_response"
    dto = {t["id"]: t for t in get_catalog(db)["templates"]}
    assert dto["final_reminder_gentle"]["flow_stage"] == "reminder"
    assert dto["final_reminder_gentle"]["own_stage"] == "final_reminder"
    assert not (default_template_for("final_reminder", "wedding", db) or "").startswith("final_reminder_gentle")
    # admin moves it back -> the open round follows to the event-reminder audience
    admin = uuid.uuid4()
    app_module.app.dependency_overrides[get_admin_user_id] = lambda: admin
    try:
        r = client.put("/admin/messaging/template-placements", headers=auth_header(admin),
                       json={"template": "final_reminder_gentle__wedding", "category_id": None})
        assert r.status_code == 200 and r.json()["moved_rounds"] == 1, (r.text, c.template, c.status)
        db.refresh(c)
        assert c.category_id == "final_reminder" and c.audience == "confirmed"
        client.put("/admin/messaging/template-placements", headers=auth_header(admin),
                   json={"template": "final_reminder_gentle", "category_id": "reminder"})
    finally:
        app_module.app.dependency_overrides.pop(get_admin_user_id, None)


def test_approved_copy_replaces_the_built_in(db):
    import json
    from app.default_rounds import default_template_for
    from app.routers.catalog import get_catalog
    orig = default_template_for("thank_you", "wedding", db)
    fam = orig.split("__")[0]
    doc = {"name": "ty_edit", "title": "תודה (עריכה)", "group": "thank_you", "body": "תודה {{guest_first_name}}!",
           "event_types": ["wedding"], "replaces": fam, "buttons": [], "header": {"type": "none"}}
    live = {"status": "approved", "meta_name": "ty_edit", "doc": doc, "version": 1}
    db.execute(text("INSERT INTO custom_templates (key, doc, meta_name, meta_status, live) "
                    "VALUES ('ty_edit', CAST(:d AS jsonb), 'ty_edit', 'approved', CAST(:l AS jsonb))"),
               {"d": json.dumps(doc), "l": json.dumps(live)})
    db.commit()
    try:
        assert default_template_for("thank_you", "wedding", db) == "custom__ty_edit"
        dto = {t["id"]: t for t in get_catalog(db)["templates"]}
        assert dto[orig]["replaced_by"] == "custom__ty_edit" and "wedding" not in dto[orig]["sendable_event_types"]
    finally:
        db.execute(text("DELETE FROM custom_templates WHERE key = 'ty_edit'"))
        db.commit()
