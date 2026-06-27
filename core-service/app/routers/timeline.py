"""Guest timeline read API (Phase 9)."""
from __future__ import annotations

import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import datetime as dt
from sqlalchemy.orm import Session

from app.db import get_db
from app.crud import event as event_crud, guest as guest_crud
from app.models.models import GuestActivity
from app.authz import require_event_permission
from shared.auth.deps import get_current_user_id
from shared.domain.roles import Action

router = APIRouter(tags=["timeline"])


class GuestEventOut(BaseModel):
    id: uuid.UUID
    type: str
    actor_type: str
    actor_id: Optional[uuid.UUID] = None
    data: Optional[dict] = None
    occurred_at: dt.datetime

    class Config:
        from_attributes = True


@router.get("/guests/{guest_id}/timeline", response_model=List[GuestEventOut])
def get_guest_timeline(
    guest_id: uuid.UUID,
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
    limit: int = Query(100, ge=1, le=500),
):
    guest = guest_crud.get_guest(db, guest_id)
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    require_event_permission(db, event_crud.get_event(db, guest.event_id), user_id, Action.GUEST_READ)
    return (
        db.query(GuestActivity)
        .filter(GuestActivity.guest_id == guest_id)
        .order_by(GuestActivity.occurred_at.desc())
        .limit(limit)
        .all()
    )
