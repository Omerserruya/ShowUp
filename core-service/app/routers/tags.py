"""Reusable account-scoped tags and guest<->tag assignment (Phase 5)."""
from __future__ import annotations

import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.crud import event as event_crud, guest as guest_crud
from app.models.models import Tag, GuestTag
from app.authz import require_event_permission
from shared.auth.deps import get_current_user_id
from shared.domain.roles import Action

router = APIRouter(tags=["tags"])


class TagIn(BaseModel):
    name: str = Field(..., max_length=50)
    color: Optional[str] = Field(None, max_length=20)


class TagOut(BaseModel):
    id: uuid.UUID
    account_id: uuid.UUID
    name: str
    color: Optional[str] = None

    class Config:
        from_attributes = True


def _event_with_account(db: Session, event_id: uuid.UUID, user_id: uuid.UUID, action: Action):
    event = event_crud.get_event(db, event_id)
    require_event_permission(db, event, user_id, action)
    if not getattr(event, "account_id", None):
        raise HTTPException(status_code=400, detail="event is not bound to an account (legacy); tags require an account")
    return event


@router.get("/events/{event_id}/tags", response_model=List[TagOut])
def list_tags(event_id: uuid.UUID, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    event = event_crud.get_event(db, event_id)
    require_event_permission(db, event, user_id, Action.EVENT_READ)
    if not getattr(event, "account_id", None):
        return []
    return db.query(Tag).filter(Tag.account_id == event.account_id).order_by(Tag.name).all()


@router.post("/events/{event_id}/tags", response_model=TagOut, status_code=201)
def create_tag(event_id: uuid.UUID, payload: TagIn, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    event = _event_with_account(db, event_id, user_id, Action.EVENT_WRITE)
    if db.query(Tag).filter(Tag.account_id == event.account_id, Tag.name == payload.name).first():
        raise HTTPException(status_code=409, detail="tag name already exists for this account")
    tag = Tag(account_id=event.account_id, name=payload.name, color=payload.color)
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


def _guest_or_404(db: Session, guest_id: uuid.UUID):
    guest = guest_crud.get_guest(db, guest_id)
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    return guest


@router.post("/guests/{guest_id}/tags/{tag_id}", status_code=204)
def assign_tag(guest_id: uuid.UUID, tag_id: uuid.UUID, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    guest = _guest_or_404(db, guest_id)
    event = event_crud.get_event(db, guest.event_id)
    require_event_permission(db, event, user_id, Action.GUEST_WRITE)
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    # Tag must exist and belong to the same account as the guest's event.
    if not tag or (getattr(event, "account_id", None) and tag.account_id != event.account_id):
        raise HTTPException(status_code=404, detail="tag not found")
    exists = db.query(GuestTag).filter(GuestTag.guest_id == guest_id, GuestTag.tag_id == tag_id).first()
    if not exists:
        db.add(GuestTag(guest_id=guest_id, tag_id=tag_id))
        db.commit()
    return None


@router.delete("/guests/{guest_id}/tags/{tag_id}", status_code=204)
def unassign_tag(guest_id: uuid.UUID, tag_id: uuid.UUID, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    guest = _guest_or_404(db, guest_id)
    require_event_permission(db, event_crud.get_event(db, guest.event_id), user_id, Action.GUEST_WRITE)
    link = db.query(GuestTag).filter(GuestTag.guest_id == guest_id, GuestTag.tag_id == tag_id).first()
    if link:
        db.delete(link)
        db.commit()
    return None
