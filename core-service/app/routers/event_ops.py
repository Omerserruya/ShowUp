"""Event-level operations: clone an event, and the guest import mapping wizard."""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.crud import event as event_crud, guest as guest_crud
from app.models.models import Event, EventFieldDef, WaTemplate, Guest, GuestCustomValue
from app.schemas.schemas import GuestCreate, EventOut
from app.authz import require_event_permission
from app.usage import record_usage
from app.routers.custom_fields import validate_field_value
from shared.auth.deps import get_current_user_id
from shared.domain.roles import Action
from shared.domain.enums import TemplateState, EventState, UsageMetric, GuestStatus

router = APIRouter(tags=["event-ops"])


# ------------------------------- Event Clone -------------------------------

class CloneEventIn(BaseModel):
    name: Optional[str] = None
    include_guests: bool = False


@router.post("/events/{event_id}/clone", response_model=EventOut, status_code=201)
def clone_event(event_id: uuid.UUID, payload: CloneEventIn, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    """Duplicate an event (config + custom fields + templates, optionally guests)
    into a new DRAFT event in the same account."""
    src = event_crud.get_event(db, event_id)
    require_event_permission(db, src, user_id, Action.EVENT_WRITE)

    new = Event(
        name=payload.name or f"{src.name} (copy)",
        description=src.description,
        event_date=src.event_date,
        location=src.location,
        inviters=src.inviters or [],
        owners=[str(user_id)],
        account_id=src.account_id,
        seating_layout=src.seating_layout,
        state=EventState.DRAFT.value,
        active=True,
    )
    db.add(new)
    db.flush()  # assign new.id

    # Copy custom field definitions, keeping a key->new-id map for guest values.
    field_map: Dict[str, uuid.UUID] = {}
    for fd in db.query(EventFieldDef).filter(EventFieldDef.event_id == event_id).all():
        nfd = EventFieldDef(
            event_id=new.id, key=fd.key, label=fd.label, data_type=fd.data_type,
            options=fd.options, required=fd.required, applies_to_template=fd.applies_to_template,
            sort_order=fd.sort_order,
        )
        db.add(nfd)
        db.flush()
        field_map[fd.key] = nfd.id

    # Copy event-scoped templates as fresh drafts.
    for t in db.query(WaTemplate).filter(WaTemplate.event_id == event_id).all():
        db.add(WaTemplate(
            event_id=new.id, account_id=t.account_id, name=t.name, body=t.body,
            language=t.language, category=t.category, components=t.components,
            lifecycle=TemplateState.DRAFT.value,
        ))

    created_guests = 0
    if payload.include_guests:
        src_fields = {fd.id: fd.key for fd in db.query(EventFieldDef).filter(EventFieldDef.event_id == event_id).all()}
        for g in db.query(Guest).filter(Guest.event_id == str(event_id)).all():
            ng = Guest(
                event_id=str(new.id), name=g.name, phone=g.phone, email=g.email, group=g.group,
                status=GuestStatus.INVITED.value, import_count=g.import_count,
                guest_count=None, table_number=g.table_number, notes=g.notes,
            )
            db.add(ng)
            db.flush()
            created_guests += 1
            # carry custom values across the field key mapping
            for cv in db.query(GuestCustomValue).filter(GuestCustomValue.guest_id == g.id).all():
                key = src_fields.get(cv.field_def_id)
                if key and key in field_map:
                    db.add(GuestCustomValue(guest_id=ng.id, field_def_id=field_map[key], value=cv.value))
        if created_guests:
            record_usage(db, account_id=new.account_id, event_id=new.id,
                         metric=UsageMetric.GUEST_ADDED, quantity=created_guests, commit=False)

    db.commit()
    db.refresh(new)
    return new


# --------------------------- Import Mapping Wizard ---------------------------

# Core target fields and their header aliases (English + Hebrew).
_CORE_ALIASES: Dict[str, List[str]] = {
    "name": ["name", "full name", "fullname", "שם", "שם מלא"],
    "phone": ["phone", "phone number", "mobile", "טלפון", "נייד"],
    "email": ["email", "e-mail", "mail", "אימייל", "מייל"],
    "group": ["group", "side", "קבוצה", "צד"],
}
_CORE_FIELDS = set(_CORE_ALIASES.keys())


class SuggestMappingIn(BaseModel):
    headers: List[str]


@router.post("/events/{event_id}/import/suggest-mapping", response_model=dict)
def suggest_mapping(event_id: uuid.UUID, payload: SuggestMappingIn, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    """Given uploaded column headers, propose a mapping to core + custom fields."""
    require_event_permission(db, event_crud.get_event(db, event_id), user_id, Action.EVENT_READ)
    custom = {f.key for f in db.query(EventFieldDef).filter(EventFieldDef.event_id == event_id).all()}

    mapping: Dict[str, Optional[str]] = {}
    for header in payload.headers:
        hl = (header or "").strip().lower()
        matched: Optional[str] = None
        for field, aliases in _CORE_ALIASES.items():
            if hl in [a.lower() for a in aliases]:
                matched = field
                break
        if not matched and hl in custom:
            matched = hl
        mapping[header] = matched
    return {"mapping": mapping, "core_fields": sorted(_CORE_FIELDS), "custom_fields": sorted(custom)}


class ApplyImportIn(BaseModel):
    mapping: Dict[str, Optional[str]]              # header -> target field (or None to ignore)
    rows: List[Dict[str, Any]] = Field(default_factory=list)


@router.post("/events/{event_id}/import/apply", response_model=dict)
def apply_import(event_id: uuid.UUID, payload: ApplyImportIn, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    """Apply a confirmed mapping to rows, creating guests (+ custom values)."""
    event = event_crud.get_event(db, event_id)
    require_event_permission(db, event, user_id, Action.GUEST_WRITE)
    field_defs = {f.key: f for f in db.query(EventFieldDef).filter(EventFieldDef.event_id == event_id).all()}

    created = []
    skipped = 0
    for row in payload.rows:
        core: Dict[str, Any] = {}
        customs: Dict[str, Any] = {}
        for header, field in payload.mapping.items():
            if not field:
                continue
            value = row.get(header)
            if field in _CORE_FIELDS:
                core[field] = value
            elif field in field_defs:
                customs[field] = value

        if not core.get("name") or not core.get("phone"):
            skipped += 1
            continue
        try:
            gc = GuestCreate(event_id=event_id, name=core["name"], phone=str(core["phone"]),
                             email=core.get("email") or None, group=core.get("group") or None)
            guest = guest_crud.create_guest(db, gc)
        except (ValueError, Exception):
            skipped += 1
            continue

        # Validate + persist custom values.
        for key, value in customs.items():
            fd = field_defs[key]
            try:
                validate_field_value(fd, value)
            except ValueError:
                continue
            db.add(GuestCustomValue(guest_id=guest.id, field_def_id=fd.id, value=value))
        created.append(guest)

    if created:
        db.commit()
        record_usage(db, account_id=getattr(event, "account_id", None), event_id=event_id,
                     metric=UsageMetric.GUEST_ADDED, quantity=len(created))
    return {"created": len(created), "skipped": skipped,
            "guest_ids": [str(g.id) for g in created]}
