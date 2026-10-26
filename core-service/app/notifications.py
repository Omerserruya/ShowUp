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


def queue_assistant_intro(db: Session, *, event, owner_user_id: uuid.UUID) -> bool:
    """Queue the one-time "meet your AI assistant" WhatsApp to a new event's owner.

    Called from the single event-construction path (entitlement redemption), so
    EVERY way an event comes into being - paid checkout, free self-service, a
    redemption/gift link, a clone, an admin or venue direct-create - introduces
    the assistant exactly once. Dedupe key is the event id, so a replayed payment
    IPN or a second writer (aub's provisioning) can never send it twice.

    Best-effort in every respect: the owner's phone lives in aub, so a failed
    directory lookup means no intro, never a failed event creation.
    """
    try:
        from app import user_directory  # local import: keeps aub HTTP out of import time

        directory = user_directory.resolve_users_by_ids([owner_user_id])
        owner = directory.get(str(owner_user_id)) or {}
        phone = (owner.get("phone") or "").strip()
        if not phone:
            logger.warning(
                "assistant intro skipped for event %s: no phone for owner %s",
                getattr(event, "id", None), owner_user_id,
            )
            return False
        return queue_owner_notification(
            db,
            kind="assistant_intro",
            recipient_phone=phone,
            params={
                "1": (owner.get("first_name") or "").strip() or "חבר/ה",
                "2": (getattr(event, "name", None) or "האירוע"),
            },
            event_id=getattr(event, "id", None),
            dedupe_key=f"assistant_intro:{event.id}",
        )
    except Exception as exc:
        logger.warning("assistant intro queue failed for event %s: %s",
                       getattr(event, "id", None), exc)
        return False
