"""WhatsApp template lifecycle + allowed-variable validation (Phase 8)."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.crud import event as event_crud
from app.models.models import WaTemplate, EventFieldDef
from app.authz import require_event_permission
from shared.auth.deps import get_current_user_id
from shared.domain.roles import Action
from shared.domain.enums import TemplateState
from shared.domain.templates import validate_template_body, can_transition

router = APIRouter(tags=["templates"])


class TemplateIn(BaseModel):
    name: str = Field(..., max_length=100)
    body: str
    language: str = "he"
    category: Optional[str] = None
    components: Optional[dict] = None


class TemplateOut(BaseModel):
    id: uuid.UUID
    account_id: Optional[uuid.UUID] = None
    event_id: Optional[uuid.UUID] = None
    name: str
    language: str
    category: Optional[str] = None
    body: str
    allowed_vars: Optional[List[str]] = None
    lifecycle: str
    meta_template_id: Optional[str] = None
    rejection_reason: Optional[str] = None

    class Config:
        from_attributes = True


class TransitionIn(BaseModel):
    to: TemplateState
    meta_template_id: Optional[str] = None
    rejection_reason: Optional[str] = None


# Flow stage -> legacy campaign label (the wizard's lookup key).
_LABEL_BY_STAGE = {
    "invitation": "Save the date",
    "reminder": "תזכורת שבוע לפני",
    "final_reminder": "תזכורת יום לפני",
    "thank_you": "תודה אחרי האירוע",
}


class PublicTemplateOut(BaseModel):
    """Metadata-rich template DTO consumed by the wizard's template fetch+filter."""
    id: uuid.UUID
    name: str
    title: Optional[str] = None
    body: str
    language: str
    flow_stage: Optional[str] = None
    campaign_label: Optional[str] = None
    event_type: Optional[str] = None
    event_types: Optional[List[str]] = None
    visibility: str
    lifecycle: str
    event_id: Optional[uuid.UUID] = None
    expires_at: Optional[datetime] = None
    components: Optional[dict] = None
    is_default: bool = False


def _template_or_404(db: Session, template_id: uuid.UUID) -> WaTemplate:
    t = db.query(WaTemplate).filter(WaTemplate.id == template_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="template not found")
    return t


def _authorize_template(db: Session, t: WaTemplate, user_id: uuid.UUID, action: Action):
    if not t.event_id:
        # Global templates are platform-managed; not editable via event-scoped API.
        raise HTTPException(status_code=403, detail="global templates are managed by platform admins")
    require_event_permission(db, event_crud.get_event(db, t.event_id), user_id, action)


@router.post("/events/{event_id}/templates", response_model=TemplateOut, status_code=201)
def create_template(event_id: uuid.UUID, payload: TemplateIn, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    event = event_crud.get_event(db, event_id)
    require_event_permission(db, event, user_id, Action.EVENT_WRITE)
    t = WaTemplate(
        event_id=event_id,
        name=payload.name,
        body=payload.body,
        language=payload.language,
        category=payload.category,
        components=payload.components,
        lifecycle=TemplateState.DRAFT.value,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.get("/events/{event_id}/templates", response_model=List[TemplateOut])
def list_templates(event_id: uuid.UUID, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    require_event_permission(db, event_crud.get_event(db, event_id), user_id, Action.EVENT_READ)
    # Event-specific templates plus global (event_id NULL) templates.
    return (
        db.query(WaTemplate)
        .filter((WaTemplate.event_id == event_id) | (WaTemplate.event_id.is_(None)))
        .order_by(WaTemplate.created_at)
        .all()
    )


@router.get("/templates/public", response_model=List[PublicTemplateOut])
def public_templates(
    event_type: Optional[str] = None,
    flow_stage: Optional[str] = None,
    language: str = "he",
    db: Session = Depends(get_db),
):
    """Public, pre-approved templates available to everyone - the source of truth
    the wizard fetches and filters by metadata (event type, flow stage, language).
    Unauthenticated by design: the wizard needs these before the user signs in.
    Adding a public template (a new seed row or via admin) surfaces here with no
    frontend change."""
    usable = [TemplateState.APPROVED.value, TemplateState.ACTIVE.value]
    q = (
        db.query(WaTemplate)
        .filter(
            WaTemplate.event_id.is_(None),
            WaTemplate.visibility == "public",
            WaTemplate.lifecycle.in_(usable),
        )
    )
    if language:
        q = q.filter(WaTemplate.language == language)
    if flow_stage:
        q = q.filter(WaTemplate.flow_stage == flow_stage)
    rows = q.order_by(WaTemplate.created_at).all()
    out: List[PublicTemplateOut] = []
    for r in rows:
        # event_type NULL/empty = fits all types; otherwise must match the query.
        if event_type and r.event_type and r.event_type != event_type:
            continue
        comp = r.components or {}
        out.append(
            PublicTemplateOut(
                id=r.id,
                name=r.name,
                title=comp.get("title"),
                body=r.body,
                language=r.language,
                flow_stage=r.flow_stage,
                campaign_label=_LABEL_BY_STAGE.get(r.flow_stage or ""),
                event_type=r.event_type,
                event_types=[r.event_type] if r.event_type else [],
                visibility=r.visibility,
                lifecycle=r.lifecycle,
                event_id=r.event_id,
                expires_at=r.expires_at,
                components=r.components,
                is_default=bool(comp.get("is_default")),
            )
        )
    return out


@router.post("/templates/{template_id}/validate", response_model=TemplateOut)
def validate_template(template_id: uuid.UUID, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    t = _template_or_404(db, template_id)
    _authorize_template(db, t, user_id, Action.EVENT_WRITE)
    # Per-event custom fields flagged applies_to_template extend the allow-list.
    extra = [
        f.key for f in db.query(EventFieldDef).filter(
            EventFieldDef.event_id == t.event_id, EventFieldDef.applies_to_template == True  # noqa: E712
        ).all()
    ]
    try:
        used = validate_template_body(t.body, extra)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if not can_transition(t.lifecycle, TemplateState.VALIDATED):
        raise HTTPException(status_code=409, detail=f"cannot validate from state '{t.lifecycle}'")
    t.allowed_vars = sorted(used)
    t.lifecycle = TemplateState.VALIDATED.value
    db.commit()
    db.refresh(t)
    return t


@router.get("/events/{event_id}/templates/usable", response_model=List[TemplateOut])
def usable_templates(event_id: uuid.UUID, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    """Templates that may actually be used to send (approved/active), event + global."""
    require_event_permission(db, event_crud.get_event(db, event_id), user_id, Action.EVENT_READ)
    usable = [TemplateState.APPROVED.value, TemplateState.ACTIVE.value]
    return (
        db.query(WaTemplate)
        .filter(
            (WaTemplate.event_id == event_id) | (WaTemplate.event_id.is_(None)),
            WaTemplate.lifecycle.in_(usable),
        )
        .order_by(WaTemplate.created_at)
        .all()
    )


@router.post("/events/{event_id}/templates/{template_id}/clone", response_model=TemplateOut, status_code=201)
def clone_template(event_id: uuid.UUID, template_id: uuid.UUID, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    """Clone a template (global, or from an event the user can read) into this event
    as a fresh DRAFT - lets owners start from an approved base ("event templates")."""
    dest_event = event_crud.get_event(db, event_id)
    require_event_permission(db, dest_event, user_id, Action.EVENT_WRITE)
    src = _template_or_404(db, template_id)
    if src.event_id and src.event_id != event_id:
        require_event_permission(db, event_crud.get_event(db, src.event_id), user_id, Action.EVENT_READ)
    clone = WaTemplate(
        event_id=event_id,
        name=f"{src.name} (copy)",
        body=src.body,
        language=src.language,
        category=src.category,
        components=src.components,
        lifecycle=TemplateState.DRAFT.value,
    )
    db.add(clone)
    db.commit()
    db.refresh(clone)
    return clone


@router.post("/templates/{template_id}/transition", response_model=TemplateOut)
def transition_template(template_id: uuid.UUID, payload: TransitionIn, db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    t = _template_or_404(db, template_id)
    _authorize_template(db, t, user_id, Action.EVENT_WRITE)
    if not can_transition(t.lifecycle, payload.to):
        raise HTTPException(status_code=409, detail=f"illegal transition '{t.lifecycle}' -> '{payload.to.value}'")
    t.lifecycle = payload.to.value
    if payload.meta_template_id is not None:
        t.meta_template_id = payload.meta_template_id
    if payload.rejection_reason is not None:
        t.rejection_reason = payload.rejection_reason
    db.commit()
    db.refresh(t)
    return t
