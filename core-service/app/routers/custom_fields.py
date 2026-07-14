"""Custom field definitions (per event) and guest custom values (Phase 4)."""
from __future__ import annotations

import uuid
import datetime as dt
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.crud import event as event_crud, guest as guest_crud
from app.models.models import EventFieldDef, GuestCustomValue
from app.authz import require_event_permission
from shared.auth.deps import get_current_user_id
from shared.domain.roles import Action
from shared.domain.enums import FieldType

router = APIRouter(tags=["custom-fields"])


class FieldDefIn(BaseModel):
    key: str = Field(..., max_length=50, pattern=r"^[a-z0-9_]+$")
    label: str = Field(..., max_length=100)
    data_type: FieldType
    options: Optional[List[str]] = None
    required: bool = False
    applies_to_template: bool = False
    sort_order: int = 0


class FieldDefOut(BaseModel):
    id: uuid.UUID
    event_id: uuid.UUID
    key: str
    label: str
    data_type: str
    options: Optional[List[str]] = None
    required: bool
    applies_to_template: bool
    sort_order: int

    class Config:
        from_attributes = True


def validate_field_value(field: EventFieldDef, value: Any) -> Any:
    """Validate a raw value against a field definition. Raises ValueError on mismatch."""
    if value is None:
        if field.required:
            raise ValueError(f"field '{field.key}' is required")
        return None
    t = field.data_type
    if t == FieldType.TEXT.value:
        if not isinstance(value, str):
            raise ValueError(f"'{field.key}' must be text")
    elif t == FieldType.NUMBER.value:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f"'{field.key}' must be a number")
    elif t == FieldType.BOOLEAN.value:
        if not isinstance(value, bool):
            raise ValueError(f"'{field.key}' must be a boolean")
    elif t == FieldType.ENUM.value:
        opts = field.options or []
        if value not in opts:
            raise ValueError(f"'{field.key}' must be one of {opts}")
    elif t == FieldType.DATE.value:
        if not isinstance(value, str):
            raise ValueError(f"'{field.key}' must be an ISO date string (YYYY-MM-DD)")
        try:
            dt.date.fromisoformat(value)
        except ValueError:
            raise ValueError(f"'{field.key}' must be an ISO date (YYYY-MM-DD)")
    return value


@router.get("/events/{event_id}/fields", response_model=List[FieldDefOut])
def list_fields(event_id: uuid.UUID, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    require_event_permission(db, event_crud.get_event(db, event_id), user_id, Action.EVENT_READ)
    return (
        db.query(EventFieldDef)
        .filter(EventFieldDef.event_id == event_id)
        .order_by(EventFieldDef.sort_order)
        .all()
    )


@router.post("/events/{event_id}/fields", response_model=FieldDefOut, status_code=201)
def create_field(event_id: uuid.UUID, payload: FieldDefIn, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    event = event_crud.get_event(db, event_id)
    require_event_permission(db, event, user_id, Action.EVENT_WRITE)
    if payload.data_type == FieldType.ENUM and not payload.options:
        raise HTTPException(status_code=422, detail="enum field requires non-empty options")
    if db.query(EventFieldDef).filter(EventFieldDef.event_id == event_id, EventFieldDef.key == payload.key).first():
        raise HTTPException(status_code=409, detail="field key already exists for this event")
    field = EventFieldDef(
        event_id=event_id,
        key=payload.key,
        label=payload.label,
        data_type=payload.data_type.value,
        options=payload.options,
        required=payload.required,
        applies_to_template=payload.applies_to_template,
        sort_order=payload.sort_order,
    )
    db.add(field)
    db.commit()
    db.refresh(field)
    return field


@router.delete("/events/{event_id}/fields/{field_id}", status_code=204)
def delete_field(event_id: uuid.UUID, field_id: uuid.UUID, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    require_event_permission(db, event_crud.get_event(db, event_id), user_id, Action.EVENT_WRITE)
    field = db.query(EventFieldDef).filter(EventFieldDef.id == field_id, EventFieldDef.event_id == event_id).first()
    if not field:
        raise HTTPException(status_code=404, detail="field not found")
    db.delete(field)
    db.commit()
    return None


def _guest_or_404(db: Session, guest_id: uuid.UUID):
    guest = guest_crud.get_guest(db, guest_id)
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    return guest


@router.get("/guests/{guest_id}/custom", response_model=dict)
def get_guest_custom(guest_id: uuid.UUID, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    guest = _guest_or_404(db, guest_id)
    require_event_permission(db, event_crud.get_event(db, guest.event_id), user_id, Action.GUEST_READ)
    defs = {f.id: f.key for f in db.query(EventFieldDef).filter(EventFieldDef.event_id == guest.event_id).all()}
    rows = db.query(GuestCustomValue).filter(GuestCustomValue.guest_id == guest_id).all()
    return {defs[r.field_def_id]: r.value for r in rows if r.field_def_id in defs}


@router.put("/guests/{guest_id}/custom", response_model=dict)
def set_guest_custom(guest_id: uuid.UUID, payload: dict = Body(...), db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    guest = _guest_or_404(db, guest_id)
    event = event_crud.get_event(db, guest.event_id)
    require_event_permission(db, event, user_id, Action.GUEST_WRITE)
    defs = {f.key: f for f in db.query(EventFieldDef).filter(EventFieldDef.event_id == guest.event_id).all()}
    for key, value in payload.items():
        if key not in defs:
            raise HTTPException(status_code=422, detail=f"unknown custom field '{key}'")
        try:
            validate_field_value(defs[key], value)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))
    # Upsert each value.
    for key, value in payload.items():
        field = defs[key]
        existing = (
            db.query(GuestCustomValue)
            .filter(GuestCustomValue.guest_id == guest_id, GuestCustomValue.field_def_id == field.id)
            .first()
        )
        if existing:
            existing.value = value
        else:
            db.add(GuestCustomValue(guest_id=guest_id, field_def_id=field.id, value=value))
    db.commit()
    return get_guest_custom(guest_id, db, user_id)
