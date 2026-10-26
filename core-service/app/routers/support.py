"""Admin support-session API - step into one live event, and step back out.

`POST /admin/support/enter` opens a session on one event; every event-scoped
endpoint then treats the admin as a MANAGER on it (app/support.py + app/authz.py),
and `GET /events` lists it so the dashboard's switcher can select it. `POST
/admin/support/exit` closes it. Both are written to the audit log naming the
event, so support access is never silent.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import support, user_directory
from app.audit import record_audit
from app.db import get_db
from app.models.models import Event
from shared.auth.admin import get_admin_user_id
from shared.domain.enums import ActorType

router = APIRouter(prefix="/admin/support", tags=["admin"])


class SupportEnterIn(BaseModel):
    event_id: uuid.UUID
    reason: Optional[str] = None


def _owner_label(event: Event) -> Optional[str]:
    """The event owner's name, for the support banner ("helping <owner>")."""
    owners = [o for o in (event.owners or []) if o]
    if not owners:
        return None
    try:
        directory = user_directory.resolve_users_by_ids([uuid.UUID(str(owners[0]))])
    except Exception:
        return None
    u = directory.get(str(owners[0])) or {}
    name = " ".join(x for x in [u.get("first_name"), u.get("last_name")] if x).strip()
    return name or u.get("phone")


def _session_payload(db: Session, session: dict) -> dict:
    event = db.query(Event).filter(Event.id == str(session["event_id"])).first()
    return {
        "event_id": str(session["event_id"]),
        "event_name": event.name if event else None,
        "owner_name": _owner_label(event) if event else None,
        "started_at": session["started_at"].isoformat() if session.get("started_at") else None,
        "expires_at": session["expires_at"].isoformat() if session.get("expires_at") else None,
    }


@router.get("/session")
def current_session(
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    """The admin's active support session, or `{"session": null}`."""
    session = support.current(db, admin_id)
    return {"session": _session_payload(db, session) if session else None}


@router.post("/enter")
def enter_event(
    payload: SupportEnterIn = Body(...),
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    """Open a support session on `event_id` (replacing any previous one)."""
    event = db.query(Event).filter(Event.id == str(payload.event_id)).first()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")

    session = support.start(db, admin_user_id=admin_id, event_id=payload.event_id)
    record_audit(
        db,
        account_id=getattr(event, "account_id", None),
        actor_type=ActorType.USER,
        actor_id=admin_id,
        action="admin.support.enter",
        entity_type="event",
        entity_id=event.id,
        data={"event_name": event.name, "reason": payload.reason},
    )
    return {"session": _session_payload(db, session)}


@router.post("/exit")
def exit_event(
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    """Close the admin's support session. Idempotent."""
    event_id = support.end(db, admin_user_id=admin_id)
    if event_id is not None:
        event = db.query(Event).filter(Event.id == str(event_id)).first()
        record_audit(
            db,
            account_id=getattr(event, "account_id", None) if event else None,
            actor_type=ActorType.USER,
            actor_id=admin_id,
            action="admin.support.exit",
            entity_type="event",
            entity_id=event_id,
            data={"event_name": event.name if event else None},
        )
    return {"session": None}
