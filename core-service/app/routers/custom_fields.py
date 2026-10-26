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
    # Optional: host questions are created from a Hebrew label, so the machine
    # key is generated when omitted.
    key: Optional[str] = Field(None, max_length=50, pattern=r"^[a-z0-9_]+$")
    label: str = Field(..., max_length=100)
    data_type: FieldType
    options: Optional[List[str]] = None
    required: bool = False
    applies_to_template: bool = False
    ask_in_rsvp: bool = False
    sort_order: int = 0


class FieldDefPatch(BaseModel):
    label: Optional[str] = Field(None, max_length=100)
    options: Optional[List[str]] = None
    required: Optional[bool] = None
    applies_to_template: Optional[bool] = None
    ask_in_rsvp: Optional[bool] = None
    sort_order: Optional[int] = None


class FieldDefOut(BaseModel):
    id: uuid.UUID
    event_id: uuid.UUID
    key: str
    label: str
    data_type: str
    options: Optional[List[str]] = None
    required: bool
    applies_to_template: bool
    ask_in_rsvp: bool = False
    sort_order: int

    class Config:
        from_attributes = True


# WhatsApp interactive limits for host questions ("שאלות לאורחים").
QUESTION_MIN_OPTIONS = 2
QUESTION_MAX_OPTIONS = 10
QUESTION_ROW_MAX = 24      # list row title (4..10 options)
QUESTION_BUTTON_MAX = 20   # reply button title (<=3 options)
QUESTION_LABEL_MAX = 100


def validate_question(label: str, data_type: str, options: Optional[List[str]]) -> List[str]:
    """Validate an ask_in_rsvp question; returns the cleaned options.

    Raises HTTPException(422) with a friendly Hebrew message.
    """
    if data_type != FieldType.ENUM.value:
        raise HTTPException(status_code=422, detail="שאלה לאורחים חייבת להיות שאלת בחירה עם תשובות")
    if not (label or "").strip():
        raise HTTPException(status_code=422, detail="צריך לכתוב את השאלה")
    opts = [str(o).strip() for o in (options or [])]
    if any(not o for o in opts):
        raise HTTPException(status_code=422, detail="אחת התשובות ריקה")
    if not (QUESTION_MIN_OPTIONS <= len(opts) <= QUESTION_MAX_OPTIONS):
        raise HTTPException(status_code=422, detail="צריך בין 2 ל־10 תשובות אפשריות")
    if len(set(opts)) != len(opts):
        raise HTTPException(status_code=422, detail="יש תשובה שמופיעה פעמיים")
    limit = QUESTION_BUTTON_MAX if len(opts) <= 3 else QUESTION_ROW_MAX
    too_long = [o for o in opts if len(o) > limit]
    if too_long:
        raise HTTPException(
            status_code=422,
            detail=f"התשובה \"{too_long[0]}\" ארוכה מדי - עד {limit} תווים (מגבלה של וואטסאפ)",
        )
    return opts


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
    options = payload.options
    if payload.ask_in_rsvp:
        options = validate_question(payload.label, payload.data_type.value, payload.options)
    key = payload.key or f"q_{uuid.uuid4().hex[:10]}"
    if db.query(EventFieldDef).filter(EventFieldDef.event_id == event_id, EventFieldDef.key == key).first():
        raise HTTPException(status_code=409, detail="field key already exists for this event")
    field = EventFieldDef(
        event_id=event_id,
        key=key,
        label=payload.label.strip(),
        data_type=payload.data_type.value,
        options=options,
        required=payload.required,
        applies_to_template=payload.applies_to_template,
        ask_in_rsvp=payload.ask_in_rsvp,
        sort_order=payload.sort_order,
    )
    db.add(field)
    db.commit()
    db.refresh(field)
    return field


def _field_or_404(db: Session, event_id: uuid.UUID, field_id: uuid.UUID) -> EventFieldDef:
    field = db.query(EventFieldDef).filter(EventFieldDef.id == field_id, EventFieldDef.event_id == event_id).first()
    if not field:
        raise HTTPException(status_code=404, detail="field not found")
    return field


@router.patch("/events/{event_id}/fields/{field_id}", response_model=FieldDefOut)
def update_field(event_id: uuid.UUID, field_id: uuid.UUID, payload: FieldDefPatch,
                 db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    require_event_permission(db, event_crud.get_event(db, event_id), user_id, Action.EVENT_WRITE)
    field = _field_or_404(db, event_id, field_id)
    changes = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    label = changes.get("label", field.label)
    options = changes.get("options", field.options)
    ask = changes.get("ask_in_rsvp", field.ask_in_rsvp)
    if ask:
        options = validate_question(label, field.data_type, options)
    elif field.data_type == FieldType.ENUM.value and not options:
        raise HTTPException(status_code=422, detail="enum field requires non-empty options")
    field.label = (label or "").strip() or field.label
    field.options = options
    for attr in ("required", "applies_to_template", "ask_in_rsvp", "sort_order"):
        if attr in changes and changes[attr] is not None:
            setattr(field, attr, changes[attr])
    db.commit()
    db.refresh(field)
    return field


def _mask_phone(phone: Optional[str]) -> str:
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if len(digits) <= 4:
        return "•" * len(digits)
    return f"{digits[:3]}•••{digits[-3:]}"


def _guest_brief(g) -> dict:
    return {"id": str(g.id), "name": g.name, "phone_masked": _mask_phone(g.phone), "people": g.guest_count or 1}


@router.get("/events/{event_id}/fields/{field_id}/results")
def field_results(event_id: uuid.UUID, field_id: uuid.UUID, db: Session = Depends(get_db),
                  user_id: uuid.UUID = Depends(get_current_user_id)):
    """Answers to one question, per option, with the guests behind each count.

    `unanswered_confirmed`: confirmed guests with no answer (or who skipped).
    Answers whose option was since renamed/removed are kept as extra entries
    with `archived: true` so nothing silently disappears.
    """
    require_event_permission(db, event_crud.get_event(db, event_id), user_id, Action.GUEST_READ)
    field = _field_or_404(db, event_id, field_id)
    from app.models.models import Guest
    from shared.domain.enums import GuestStatus

    guests = db.query(Guest).filter(Guest.event_id == str(event_id)).order_by(Guest.name).all()
    values = {
        str(v.guest_id): v.value
        for v in db.query(GuestCustomValue).filter(GuestCustomValue.field_def_id == field.id).all()
    }
    options = [str(o) for o in (field.options or [])]
    buckets: dict = {o: [] for o in options}
    archived: dict = {}
    unanswered = []
    total = 0
    for g in guests:
        val = values.get(str(g.id))
        if val is None or val == "":
            if GuestStatus.normalize(g.status) == GuestStatus.CONFIRMED:
                unanswered.append(_guest_brief(g))
            continue
        total += 1
        key = str(val)
        target = buckets[key] if key in buckets else archived.setdefault(key, [])
        target.append(_guest_brief(g))

    def _entry(label, gl, is_archived=False):
        out = {"label": label, "count": len(gl), "people": sum(x["people"] for x in gl), "guests": gl}
        if is_archived:
            out["archived"] = True
        return out

    return {
        "field": FieldDefOut.model_validate(field).model_dump(mode="json")
        if hasattr(FieldDefOut, "model_validate") else FieldDefOut.from_orm(field).dict(),
        "options": [_entry(o, buckets[o]) for o in options]
        + [_entry(k, gl, True) for k, gl in archived.items()],
        "unanswered_confirmed": unanswered,
        "total_answered": total,
    }


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
