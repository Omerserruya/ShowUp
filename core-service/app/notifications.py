"""Owner-notification outbox writer.

Queue a WhatsApp notification to an event owner / team member. Rows land in
the shared `owner_notifications` table; the scheduler-service dispatcher
resolves the template (shared/content/system_templates.yaml), publishes to
the outpost queue and marks the row sent. Best-effort by design: a failed
queue insert must never break the business action that triggered it.
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def queue_owner_notification(
    db: Session,
    *,
    kind: str,
    recipient_phone: str,
    params: dict,
    event_id: Optional[uuid.UUID] = None,
    dedupe_key: Optional[str] = None,
    commit: bool = True,
) -> bool:
    """Insert an outbox row. Returns True if queued (False on dedupe/error).

    `params` are the WhatsApp template's positional body parameters, keyed by
    "1", "2", ... - they must match the template contract in
    shared/content/system_templates.yaml for `kind`.
    """
    try:
        row = db.execute(
            text(
                """
                INSERT INTO owner_notifications (kind, recipient_phone, event_id, params, dedupe_key)
                VALUES (:kind, :phone, :event_id, CAST(:params AS jsonb), :dedupe)
                ON CONFLICT (dedupe_key) DO NOTHING
                RETURNING id
                """
            ),
            {
                "kind": kind,
                "phone": recipient_phone,
                "event_id": str(event_id) if event_id else None,
                "params": json.dumps({str(k): str(v) for k, v in (params or {}).items()}, ensure_ascii=False),
                "dedupe": dedupe_key,
            },
        ).fetchone()
        if commit:
            db.commit()
        return row is not None
    except Exception as exc:
        logger.warning("owner notification queue failed (kind=%s): %s", kind, exc)
        try:
            db.rollback()
        except Exception:
            pass
        return False
