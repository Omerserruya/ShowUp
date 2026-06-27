"""Campaign-worker integration check (Phase 14).

Runs INSIDE the campaign-worker image against a real Postgres (schema applied via
core-service Alembic). Exercises the worker's DB logic end-to-end: audience
selection, follow-up creation + idempotency, and message metering. Plain asserts
(no pytest dependency in the worker image).
"""
import uuid

from db import (
    connect,
    ensure_schema,
    fetch_campaign_by_id,
    create_follow_up_campaign,
    record_message_usage,
)
from audience import select_guests_by_audience


def main():
    conn = connect()
    ensure_schema(conn)

    eid = str(uuid.uuid4())
    cid = str(uuid.uuid4())
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO events (id, name, owners, inviters, active, state) "
            "VALUES (%s, 'E', '[]'::json, '[]'::json, true, 'active')",
            (eid,),
        )
        cur.execute(
            "INSERT INTO guests (id, event_id, name, phone, status, import_count) "
            "VALUES (%s, %s, 'A', '+972500000001', 'confirmed', 1)",
            (str(uuid.uuid4()), eid),
        )
        cur.execute(
            "INSERT INTO guests (id, event_id, name, phone, status, import_count) "
            "VALUES (%s, %s, 'B', '+972500000002', 'invited', 1)",
            (str(uuid.uuid4()), eid),
        )

    # Audience selection (decoupled from template).
    assert len(select_guests_by_audience(conn, eid, "everyone")) == 2
    assert len(select_guests_by_audience(conn, eid, "confirmed")) == 1
    assert len(select_guests_by_audience(conn, eid, "no_response")) == 1
    assert len(select_guests_by_audience(conn, eid, "declined")) == 0

    # Campaign + follow-up creation + idempotency.
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO campaigns (id, event_id, name, template, channel, status, recipient_count, audience) "
            "VALUES (%s, %s, 'R1', 'event_no_pic', 'whatsapp', 'sent', 0, 'everyone')",
            (cid, eid),
        )
    parent = fetch_campaign_by_id(conn, cid)
    assert parent and parent["audience"] == "everyone"
    new_id = create_follow_up_campaign(conn, parent, 48, "no_response")
    assert new_id, "follow-up campaign should be created"
    assert create_follow_up_campaign(conn, parent, 48, "no_response") is None, "follow-up must be idempotent"

    # Message metering.
    record_message_usage(conn, None, eid, 5, cid)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT COALESCE(SUM(quantity), 0) FROM usage_events WHERE event_id = %s AND metric = 'message_sent'",
            (eid,),
        )
        assert cur.fetchone()[0] == 5

    print("WORKER INTEGRATION OK")


if __name__ == "__main__":
    main()
