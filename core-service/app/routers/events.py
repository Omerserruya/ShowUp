from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.crud import event as event_crud
from app.schemas.schemas import EventCreate, EventOut, EventUpdate, InvitationConfig
from pydantic import BaseModel
from app.utils import paginate_params
from shared.auth.deps import get_current_user_id
from shared.domain.roles import Action
from shared.domain.enums import EventState, TemplateState
from shared.domain.lifecycle import can_transition_event, is_live
from shared.domain.entitlements import Feature
from app.authz import ensure_personal_account, require_event_permission, require_feature
from app.models.models import WaTemplate


router = APIRouter(prefix="/events", tags=["events"])


@router.get("/healthz")
def healthz():
    return {"status": "ok"}


@router.get("", response_model=list[EventOut])
def list_events(
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    search: Optional[str] = Query(None),
):
    page, page_size = paginate_params(page, page_size)
    items, _ = event_crud.list_events_for_user(db, user_id=user_id, page=page, page_size=page_size, search=search)
    # FastAPI will serialize using response_model, which uses model_dump(by_alias=True) via our override
    return items


@router.get("/{event_id}", response_model=EventOut)
def get_event(event_id: uuid.UUID, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    event = event_crud.get_event(db, event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found")
    # FastAPI will serialize using response_model, which uses model_dump(by_alias=True) via our override
    return event


@router.post("", response_model=EventOut, status_code=201)
def create_event(payload: EventCreate, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    # Force owners to current user only on creation
    payload.owners = [user_id]
    event = event_crud.create_event(db, payload)
    # V2 tenancy: bind the new event to the creator's account (OWNER membership).
    event.account_id = ensure_personal_account(db, user_id)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.put("/{event_id}", response_model=EventOut)
def update_event(event_id: uuid.UUID, payload: EventUpdate, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    event = event_crud.get_event(db, event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found or not permitted")
    event = event_crud.update_event(db, event, payload)
    # FastAPI will serialize using response_model, which uses model_dump(by_alias=True) via our override
    return event


class EventTransitionIn(BaseModel):
    to: EventState


@router.post("/{event_id}/transition", response_model=EventOut)
def transition_event(event_id: uuid.UUID, payload: EventTransitionIn, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    event = event_crud.get_event(db, event_id)
    # Cancelling is destructive (owner-only); other transitions need EVENT_WRITE.
    action = Action.EVENT_DELETE if payload.to == EventState.CANCELLED else Action.EVENT_WRITE
    require_event_permission(db, event, user_id, action)

    if not can_transition_event(event.state, payload.to):
        raise HTTPException(status_code=409, detail=f"illegal event transition '{event.state}' -> '{payload.to.value}'")

    event.state = payload.to.value
    event.active = is_live(payload.to)

    # Archive the event's live templates when the event is completed or archived.
    if payload.to in (EventState.COMPLETED, EventState.ARCHIVED):
        templates = db.query(WaTemplate).filter(
            WaTemplate.event_id == event_id,
            WaTemplate.lifecycle.in_([TemplateState.APPROVED.value, TemplateState.ACTIVE.value]),
        ).all()
        for t in templates:
            t.lifecycle = TemplateState.ARCHIVED.value

    db.add(event)
    db.commit()
    db.refresh(event)
    return event


# ---- Public web invitation management (Phase 16) ----

import re
import uuid as _uuid


def _slugify(value: str) -> str:
    """URL-safe slug: keep unicode letters/digits, collapse the rest to '-'."""
    value = (value or "").strip().lower()
    value = re.sub(r"[\s/]+", "-", value)
    value = re.sub(r"[^\w\-֐-׿]", "", value, flags=re.UNICODE)  # allow Hebrew block
    value = re.sub(r"-{2,}", "-", value).strip("-")
    return value or "event"


def _unique_slug(db: Session, base: str, current_event_id) -> str:
    base = _slugify(base)
    candidate = base
    for _ in range(50):
        existing = event_crud.get_event_by_slug(db, candidate)
        if existing is None or str(existing.id) == str(current_event_id):
            return candidate
        candidate = f"{base}-{_uuid.uuid4().hex[:6]}"
    # Extremely unlikely fallback
    return f"{base}-{_uuid.uuid4().hex[:10]}"


class InvitationPublishIn(BaseModel):
    slug: Optional[str] = None
    published: bool = True


@router.put("/{event_id}/invitation", response_model=EventOut)
def update_invitation(
    event_id: uuid.UUID,
    payload: InvitationConfig,
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Save the web invitation design. Requires EVENT_WRITE (role) AND the
    WEB_INVITATION feature (tier)."""
    event = event_crud.get_event(db, event_id)
    require_event_permission(db, event, user_id, Action.EVENT_WRITE)
    require_feature(event, Feature.WEB_INVITATION)
    event.invitation = payload.model_dump()
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.post("/{event_id}/invitation/publish", response_model=EventOut)
def publish_invitation(
    event_id: uuid.UUID,
    payload: InvitationPublishIn,
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Publish (or unpublish) the public web invitation, assigning a unique slug
    on first publish. Requires EVENT_WRITE + WEB_INVITATION."""
    event = event_crud.get_event(db, event_id)
    require_event_permission(db, event, user_id, Action.EVENT_WRITE)
    require_feature(event, Feature.WEB_INVITATION)

    if payload.published:
        desired = payload.slug or event.public_slug or event.name
        event.public_slug = _unique_slug(db, desired, event.id)
        event.invitation_published = True
    else:
        event.invitation_published = False

    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.delete("/{event_id}", status_code=204)
def delete_event(event_id: uuid.UUID, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    event = event_crud.get_event(db, event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found or not permitted")
    event_crud.delete_event(db, event)
    return None


