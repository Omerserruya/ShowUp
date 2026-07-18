"""Owner-notification outbox dispatcher.

Writers (core-service: team invites; aub-service: assistant intro; this
service: daily summaries could migrate here too) INSERT rows into
`owner_notifications`. Every scheduler cycle this module claims pending rows
(FOR UPDATE SKIP LOCKED - safe with multiple scheduler instances), resolves
the WhatsApp template from the system-templates SSOT
(shared/content/system_templates.yaml) and publishes one outpost message per
row. Rows that keep failing are parked as status='failed' after MAX_ATTEMPTS.
"""

import json
import logging
import os
from typing import Callable

import psycopg2
import psycopg2.extras

from shared.domain.messaging.system_templates import get_system_template

logger = logging.getLogger("notifications")

MAX_ATTEMPTS = int(os.getenv("OWNER_NOTIFICATIONS_MAX_ATTEMPTS", "5"))
BATCH_SIZE = int(os.getenv("OWNER_NOTIFICATIONS_BATCH", "50"))


def ensure_owner_notifications_table(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS owner_notifications (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                kind VARCHAR(40) NOT NULL,
                recipient_phone VARCHAR(32) NOT NULL,
                event_id UUID,
                params JSONB NOT NULL DEFAULT '{}',
                status VARCHAR(20) NOT NULL DEFAULT 'pending',
                attempts INTEGER NOT NULL DEFAULT 0,
                dedupe_key VARCHAR(160) UNIQUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                sent_at TIMESTAMPTZ
            )
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_owner_notifications_pending ON owner_notifications (created_at) WHERE status = 'pending'"
        )


def _build_message(row: dict) -> dict:
    tmpl = get_system_template(row["kind"])
    if tmpl is None:
        raise ValueError(f"no system template for kind '{row['kind']}'")
    params = row["params"] or {}
    if isinstance(params, str):
        params = json.loads(params)
    return {
        "platform": "WA",
        "message_type": "template",
        "recipient": row["recipient_phone"],
        "template": tmpl.meta_name,
        "language": tmpl.language,
        "parameters": {str(k): str(v) for k, v in params.items()},
        "sender": "assistant",
        "event_id": str(row["event_id"]) if row.get("event_id") else None,
        "source": f"owner_notification:{row['kind']}",
    }


def dispatch_owner_notifications(conn, publish: Callable[[dict], None]) -> int:
    """Publish pending outbox rows. Returns how many were sent this cycle."""
    sent = 0
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        # The scheduler connection is autocommit; FOR UPDATE SKIP LOCKED only
        # protects concurrent dispatchers inside a real transaction.
        cur.execute("BEGIN")
        cur.execute(
            """
            SELECT id, kind, recipient_phone, event_id, params, attempts
            FROM owner_notifications
            WHERE status = 'pending'
            ORDER BY created_at
            LIMIT %s
            FOR UPDATE SKIP LOCKED
            """,
            (BATCH_SIZE,),
        )
        rows = cur.fetchall()
        for row in rows:
            try:
                publish(_build_message(row))
                cur.execute(
                    "UPDATE owner_notifications SET status = 'sent', sent_at = NOW() WHERE id = %s",
                    (row["id"],),
                )
                sent += 1
            except Exception as e:
                attempts = int(row["attempts"] or 0) + 1
                status = "failed" if attempts >= MAX_ATTEMPTS else "pending"
                cur.execute(
                    "UPDATE owner_notifications SET attempts = %s, status = %s WHERE id = %s",
                    (attempts, status, row["id"]),
                )
                logger.error(
                    "Owner notification publish failed | id=%s kind=%s attempt=%s status=%s error=%s",
                    row["id"], row["kind"], attempts, status, e,
                )
        cur.execute("COMMIT")
    if sent:
        logger.info("Owner notifications dispatched | sent=%s", sent)
    return sent
