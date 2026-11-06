"""Landing-page leads: every visitor who asked for a sample WhatsApp message or a
sample phone call. One table (`demo_leads`), written by whichever service took
the request (aub: WhatsApp demo, voice-service: demo call), read by the admin
"פניות" page, and announced to every admin on WhatsApp through the
owner_notifications outbox (scheduler-service sends it, template lead_alert).

Recording must never break the demo itself - callers wrap it and log on error.
"""
from __future__ import annotations

import json
from datetime import date
from typing import Optional

KINDS = ("whatsapp", "call")

# Approved-on-Meta system template the admins get per new lead
# (shared/content/system_templates.yaml: lead_alert).
ALERT_TEMPLATE = "lead_alert"
KIND_LABEL_HE = {"whatsapp": "הודעת בדיקה בוואטסאפ", "call": "שיחת בדיקה"}

CREATE_SQL = """
CREATE TABLE IF NOT EXISTS demo_leads (
    id BIGSERIAL PRIMARY KEY,
    kind VARCHAR(20) NOT NULL,
    name TEXT,
    phone VARCHAR(32) NOT NULL,
    ip_hash VARCHAR(64),
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
"""
INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_demo_leads_created ON demo_leads (created_at DESC)"


def e164(phone: str) -> str:
    """+9725XXXXXXXX from any Israeli/E.164 spelling (digits only otherwise)."""
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("0"):
        digits = "972" + digits[1:]
    return "+" + digits if digits else ""


def record_lead(cur, kind: str, name: str, phone: str,
                ip_hash: Optional[str] = None, user_agent: Optional[str] = None) -> None:
    """Insert one lead with a DB-API (psycopg2) cursor. Creates the table on first
    use so the order services start in does not matter."""
    if kind not in KINDS:
        raise ValueError(f"unknown lead kind {kind!r}")
    cur.execute(CREATE_SQL)
    cur.execute(
        "INSERT INTO demo_leads (kind, name, phone, ip_hash, user_agent) VALUES (%s, %s, %s, %s, %s)",
        (kind, (name or "").strip()[:200] or None, e164(phone), ip_hash, (user_agent or "")[:400] or None),
    )
    _queue_alert(cur, kind, name, phone)


def _queue_alert(cur, kind: str, name: str, phone: str) -> None:
    """One WhatsApp alert per admin, at most once a day per lead phone (a visitor
    pressing twice is one lead). Skipped quietly before the outbox exists."""
    cur.execute("SELECT to_regclass('public.owner_notifications') IS NOT NULL AS ok")
    row = cur.fetchone()
    if not (row["ok"] if isinstance(row, dict) else row[0]):  # plain or RealDict cursor
        return
    lead = e164(phone)
    digits = lead.lstrip("+")
    local = "0" + digits[3:] if digits.startswith("972") else digits
    cur.execute(
        """INSERT INTO owner_notifications (kind, recipient_phone, params, dedupe_key)
           SELECT %s, u.phone, %s::jsonb, %s || ':' || u.id
           FROM users u WHERE u.role = 'admin' AND u.phone IS NOT NULL AND u.status IS DISTINCT FROM 'disabled'
           ON CONFLICT (dedupe_key) DO NOTHING""",
        (ALERT_TEMPLATE,
         json.dumps({"1": (name or "").strip()[:60] or "ללא שם", "2": local, "3": KIND_LABEL_HE.get(kind, kind)},
                    ensure_ascii=False),
         f"lead:{digits}:{date.today().isoformat()}"),
    )
