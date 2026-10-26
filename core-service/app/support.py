"""Admin support sessions - a platform admin stepping into one live event.

A support session is the ONE way a platform admin gains owner-side access to an
event they do not own. It is deliberately narrow:

* **explicit** - the admin picks an event in the admin console; nothing is
  granted implicitly just because a user has `role = 'admin'`;
* **scoped** - exactly one event at a time (the admin_user_id is the PK), so a
  stray request can never reach a second tenant;
* **time-boxed** - it expires by itself (SUPPORT_SESSION_TTL_HOURS, default 8),
  so a forgotten session is not permanent cross-tenant access;
* **audited** - start and end both write an `audit_log` row naming the event.

The role handed out is MANAGER, not OWNER: support can see everything and fix
things for the owner, but cannot delete the event or touch billing.
"""
from __future__ import annotations

import logging
import os
import uuid
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

SESSION_TTL_HOURS = int(os.getenv("SUPPORT_SESSION_TTL_HOURS", "8"))


# Set once if the underlying tables are absent (core's test DB has no aub
# `users` table). After that the lookups short-circuit instead of failing a
# statement on every request.
_unavailable = False


def _read(db: Session, sql: str, params: dict):
    """Run a support-session read inside a SAVEPOINT.

    These lookups run in the middle of a live request transaction, so a failing
    statement must not poison it. The savepoint contains the damage: on error we
    roll back to it, the caller's transaction stays usable, and access is denied.
    """
    global _unavailable
    if _unavailable:
        return None
    try:
        with db.begin_nested():
            return db.execute(text(sql), params).mappings().first()
    except Exception as exc:  # pragma: no cover - degraded DB / schema-less test env
        # Latch ONLY on a missing table (a deployment without the migration, or
        # core's schema-less test DB, which has no aub `users`). A transient
        # error must stay transient - latching on it would disable support
        # access until the next restart.
        if "does not exist" in str(exc).lower():
            _unavailable = True
            logger.warning("support sessions disabled - missing table: %s", exc)
        else:
            logger.warning("support lookup failed: %s", exc)
        return None


def support_event_id(db: Session, user_id: uuid.UUID) -> Optional[uuid.UUID]:
    """The event this user is currently supporting, or None.

    One query answers both "is this an admin?" and "which event?" - the join
    yields no row for a non-admin, so the common case costs a single lookup.
    """
    row = _read(
        db,
        """
        SELECT s.event_id
        FROM users u
        JOIN admin_support_sessions s ON s.admin_user_id = u.id
        WHERE u.id = :uid
          AND u.role = 'admin'
          AND s.expires_at > NOW()
        """,
        {"uid": str(user_id)},
    )
    return uuid.UUID(str(row["event_id"])) if row else None


def has_support_access(db: Session, event, user_id: uuid.UUID) -> bool:
    """True when `user_id` is an admin whose ACTIVE support session targets this
    event. Call it only after the normal ownership/membership check has failed,
    so ordinary users never pay for the extra query."""
    if event is None or getattr(event, "id", None) is None:
        return False
    target = support_event_id(db, user_id)
    return target is not None and str(target) == str(event.id)


def start(db: Session, *, admin_user_id: uuid.UUID, event_id: uuid.UUID) -> dict:
    """Open (or move) this admin's support session to `event_id`. Returns the
    session row. An admin holds at most one session - entering a second event
    replaces the first, it never accumulates access."""
    row = db.execute(
        text(
            f"""
            INSERT INTO admin_support_sessions (admin_user_id, event_id, started_at, expires_at)
            VALUES (:uid, :eid, NOW(), NOW() + INTERVAL '{SESSION_TTL_HOURS} hours')
            ON CONFLICT (admin_user_id) DO UPDATE
              SET event_id = EXCLUDED.event_id,
                  started_at = NOW(),
                  expires_at = EXCLUDED.expires_at
            RETURNING event_id, started_at, expires_at
            """
        ),
        {"uid": str(admin_user_id), "eid": str(event_id)},
    ).mappings().first()
    db.commit()
    return dict(row) if row else {}


def end(db: Session, *, admin_user_id: uuid.UUID) -> Optional[uuid.UUID]:
    """Close this admin's support session. Returns the event id it targeted (or
    None if there was none), so the caller can audit what was left."""
    row = db.execute(
        text("DELETE FROM admin_support_sessions WHERE admin_user_id = :uid RETURNING event_id"),
        {"uid": str(admin_user_id)},
    ).first()
    db.commit()
    return uuid.UUID(str(row[0])) if row else None


def current(db: Session, admin_user_id: uuid.UUID) -> Optional[dict]:
    """The admin's active session as {event_id, started_at, expires_at}, or None."""
    row = _read(
        db,
        """
        SELECT event_id, started_at, expires_at
        FROM admin_support_sessions
        WHERE admin_user_id = :uid AND expires_at > NOW()
        """,
        {"uid": str(admin_user_id)},
    )
    return dict(row) if row else None
