"""Customer-facing usage view (Phase 10 metering surfaced to users).

Returns guests + rounds used for an event. Plan limits live in MongoDB and are
fetched by the frontend via /api/plans/{plan_id}. Messages are NEVER exposed —
they're an internal cost metric, not a customer quota.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.crud import event as event_crud
from app.models.models import Guest, UsageEvent
from app.authz import require_event_permission
from shared.auth.deps import get_current_user_id
from shared.domain.roles import Action
from shared.domain.enums import UsageMetric

router = APIRouter(tags=["usage"])


@router.get("/usage")
def get_usage(
    event_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    event = event_crud.get_event(db, event_id)
    require_event_permission(db, event, user_id, Action.EVENT_READ)
    guests_used = db.query(func.count(Guest.id)).filter(Guest.event_id == event_id).scalar() or 0
    rounds_used = (
        db.query(func.coalesce(func.sum(UsageEvent.quantity), 0))
        .filter(UsageEvent.event_id == event_id, UsageEvent.metric == UsageMetric.ROUND_LAUNCHED.value)
        .scalar()
        or 0
    )
    return {
        "event_id": str(event_id),
        "plan_id": event.plan_id,
        "guests_used": int(guests_used),
        "rounds_used": int(rounds_used),
    }
