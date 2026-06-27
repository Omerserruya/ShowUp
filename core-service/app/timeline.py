"""Guest timeline recording (Phase 9).

A single helper that appends an activity to the guest_events table. Called by the
guest write paths, tag assignment, the RSVP flow (future), and AI tools (Phase 11)
so every meaningful change is on the guest's timeline.
"""
from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import GuestActivity
from shared.domain.enums import GuestEventType, ActorType


def record_guest_event(
    db: Session,
    *,
    guest_id,
    event_id,
    type: GuestEventType,
    actor_type: ActorType,
    actor_id: Optional[uuid.UUID] = None,
    data: Optional[dict] = None,
    commit: bool = True,
) -> GuestActivity:
    entry = GuestActivity(
        guest_id=str(guest_id),
        event_id=str(event_id),
        type=type.value if isinstance(type, GuestEventType) else str(type),
        actor_type=actor_type.value if isinstance(actor_type, ActorType) else str(actor_type),
        actor_id=actor_id,
        data=data,
    )
    db.add(entry)
    if commit:
        db.commit()
        db.refresh(entry)
    return entry
