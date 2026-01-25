from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.crud import event as event_crud
from app.schemas.schemas import EventCreate, EventOut, EventUpdate
from app.utils import paginate_params
from shared.auth.deps import get_current_user_id


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


@router.get("/test", response_model=dict)
def test_endpoint():
    """Test endpoint that doesn't require authentication"""
    return {"message": "API is working!", "status": "ok"}


@router.get("/{event_id}", response_model=EventOut)
def get_event(event_id: uuid.UUID, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    event = event_crud.get_event(db, event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found")
    # FastAPI will serialize using response_model, which uses model_dump(by_alias=True) via our override
    return event


@router.post("", response_model=EventOut, status_code=201)
def create_event(payload: EventCreate, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    print(f"[CREATE_EVENT_ROUTER] Received payload: name={payload.name}, location={payload.location}")
    print(f"[CREATE_EVENT_ROUTER] Location type={type(payload.location)}, length={len(payload.location) if payload.location else 0}")
    # Force owners to current user only on creation
    payload.owners = [user_id]
    event = event_crud.create_event(db, payload)
    print(f"[CREATE_EVENT_ROUTER] Returning event: id={event.id}, location={event.location}")
    # FastAPI will serialize using response_model, which uses model_dump(by_alias=True) via our override
    return event


@router.put("/{event_id}", response_model=EventOut)
def update_event(event_id: uuid.UUID, payload: EventUpdate, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    event = event_crud.get_event(db, event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found or not permitted")
    event = event_crud.update_event(db, event, payload)
    # FastAPI will serialize using response_model, which uses model_dump(by_alias=True) via our override
    return event


@router.delete("/{event_id}", status_code=204)
def delete_event(event_id: uuid.UUID, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    event = event_crud.get_event(db, event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found or not permitted")
    event_crud.delete_event(db, event)
    return None


