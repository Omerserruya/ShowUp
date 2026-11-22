"""Landing-page leads (shared/domain/leads.py): recorded once per request,
listed one row per phone for admins, with whether the lead signed up / opened
an event; every admin gets one WhatsApp alert per lead per day."""
from __future__ import annotations

import uuid

from sqlalchemy import text

from shared.domain import leads


def _setup(db):
    db.execute(text("""CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY, phone TEXT, email TEXT,
        first_name TEXT, last_name TEXT, role VARCHAR(20) DEFAULT 'user', status TEXT,
        created_at TIMESTAMPTZ DEFAULT now())"""))
    db.execute(text("""CREATE TABLE IF NOT EXISTS owner_notifications (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        kind VARCHAR(40) NOT NULL, recipient_phone VARCHAR(32) NOT NULL, event_id UUID,
        params JSONB NOT NULL DEFAULT '{}', status VARCHAR(20) NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0, dedupe_key VARCHAR(160) UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), sent_at TIMESTAMPTZ)"""))
    db.execute(text("DELETE FROM owner_notifications WHERE kind = 'lead_alert'"))
    db.execute(text(leads.CREATE_SQL))
    db.execute(text("DELETE FROM demo_leads"))
    db.commit()


def _record(db, kind, name, phone):
    raw = db.connection().connection.dbapi_connection if hasattr(db.connection().connection, "dbapi_connection") \
        else db.connection().connection
    with raw.cursor() as cur:
        leads.record_lead(cur, kind, name, phone, ip_hash="x", user_agent="test")
    db.commit()


def test_leads_are_listed_alerted_and_tracked(client, db, app_module):
    from shared.auth.admin import get_admin_user_id
    from tests.conftest import auth_header
    _setup(db)
    admin = uuid.uuid4()
    db.execute(text("INSERT INTO users (id, phone, role) VALUES (:id, '+972500000001', 'admin')"), {"id": admin})
    signed = uuid.uuid4()
    db.execute(text("INSERT INTO users (id, phone, role) VALUES (:id, '+972521111111', 'user')"), {"id": signed})
    db.commit()

    _record(db, "whatsapp", "דנה כהן", "052-1111111")
    _record(db, "call", "דנה", "+972521111111")      # same person, other demo
    _record(db, "call", "", "0547777777")

    alerts = db.execute(text("SELECT recipient_phone, params FROM owner_notifications "
                             "WHERE kind = 'lead_alert' ORDER BY created_at")).all()
    assert [a[0] for a in alerts] == ["+972500000001", "+972500000001"]   # once a day per lead phone
    assert alerts[0][1] == {"1": "דנה כהן", "2": "0521111111", "3": "הודעת בדיקה בוואטסאפ"}
    assert alerts[1][1]["1"] == "ללא שם" and alerts[1][1]["3"] == "שיחת בדיקה"

    app_module.app.dependency_overrides[get_admin_user_id] = lambda: admin
    try:
        r = client.get("/admin/leads", headers=auth_header(admin))
    finally:
        app_module.app.dependency_overrides.pop(get_admin_user_id, None)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 2 and body["new_7d"] == 2
    dana = next(l for l in body["leads"] if l["phone"] == "+972521111111")
    assert dana["kinds"] == ["call", "whatsapp"] and dana["requests"] == 2 and dana["name"] == "דנה"
    assert dana["signed_up"] is True and dana["events"] == 0
    other = next(l for l in body["leads"] if l["phone"] == "+972547777777")
    assert other["signed_up"] is False and other["name"] is None


def test_leads_page_is_admin_only(client):
    from tests.conftest import auth_header
    assert client.get("/admin/leads", headers=auth_header(uuid.uuid4())).status_code in (401, 403)
