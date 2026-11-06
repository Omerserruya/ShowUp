"""Phone-call rounds for the event owner, shown next to the message rounds.

    GET  /events/{event_id}/call-rounds                     plan allowance + rounds
    POST /events/{event_id}/call-rounds                     {start_at} add a round
    PUT  /events/{event_id}/call-rounds/{round_id}          {start_at} move a round
    POST /events/{event_id}/call-rounds/{round_id}/cancel

    POST /internal/voice/send-invitation  {event_id, guest_id}   (voice-service)
         a guest pressed 9 on a call: send them the invitation on WhatsApp

voice-service owns the rounds (and plans the automatic ones from
shared/domain/round_plan.py); this router only adds the event RBAC check and
forwards with the shared internal secret.
"""
from __future__ import annotations

import datetime as dt
import os
import uuid
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.authz import require_event_permission
from app.crud import event as event_crud
from app.db import get_db
from app.internal_auth import require_internal_secret
from shared.auth.deps import get_current_user_id
from shared.domain.roles import Action

router = APIRouter(prefix="/events", tags=["call-rounds"])


def _voice(method: str, path: str, json: Optional[dict] = None) -> Any:
    base = (os.getenv("VOICE_SERVICE_URL") or "http://voice-service:8090").rstrip("/")
    try:
        r = httpx.request(method, f"{base}/internal{path}", json=json, timeout=15,
                          headers={"X-Internal-Secret": os.getenv("INTERNAL_API_SECRET") or ""})
    except httpx.HTTPError:
        raise HTTPException(503, {"error": "calls_unavailable"})
    if r.status_code >= 400:
        try:
            detail = r.json().get("detail")
        except ValueError:
            detail = None
        if r.status_code >= 500:
            raise HTTPException(503, {"error": "calls_unavailable"})
        raise HTTPException(r.status_code, detail or {"error": "failed"})
    return r.json()


def _event(db: Session, event_id: uuid.UUID, user_id: uuid.UUID, action: Action):
    event = event_crud.get_event(db, event_id)
    require_event_permission(db, event, user_id, action)
    return event


class RoundIn(BaseModel):
    start_at: dt.datetime


@router.get("/{event_id}/call-rounds")
def list_call_rounds(event_id: uuid.UUID, db: Session = Depends(get_db),
                     user_id: uuid.UUID = Depends(get_current_user_id)):
    _event(db, event_id, user_id, Action.CAMPAIGN_READ)
    return _voice("GET", f"/events/{event_id}/call-rounds")


@router.post("/{event_id}/call-rounds", status_code=201)
def add_call_round(event_id: uuid.UUID, body: RoundIn, db: Session = Depends(get_db),
                   user_id: uuid.UUID = Depends(get_current_user_id)):
    _event(db, event_id, user_id, Action.CAMPAIGN_WRITE)
    return JSONResponse(status_code=201, content=_voice(
        "POST", f"/events/{event_id}/call-rounds",
        {"start_at": body.start_at.isoformat(), "created_by": str(user_id)}))


@router.put("/{event_id}/call-rounds/{round_id}")
def move_call_round(event_id: uuid.UUID, round_id: uuid.UUID, body: RoundIn, db: Session = Depends(get_db),
                    user_id: uuid.UUID = Depends(get_current_user_id)):
    _event(db, event_id, user_id, Action.CAMPAIGN_WRITE)
    return _voice("PUT", f"/events/{event_id}/call-rounds/{round_id}", {"start_at": body.start_at.isoformat()})


@router.post("/{event_id}/call-rounds/{round_id}/cancel")
def cancel_call_round(event_id: uuid.UUID, round_id: uuid.UUID, db: Session = Depends(get_db),
                      user_id: uuid.UUID = Depends(get_current_user_id)):
    _event(db, event_id, user_id, Action.CAMPAIGN_WRITE)
    return _voice("POST", f"/events/{event_id}/call-rounds/{round_id}/cancel")


# ---- voice-service -> core -------------------------------------------------------------

internal_router = APIRouter(prefix="/internal/voice", tags=["internal"])


class SendInvitationIn(BaseModel):
    event_id: uuid.UUID
    guest_id: uuid.UUID


def _invitation_for_resend(db: Session, event):
    """The invitation the guest got (the latest sent invitation round), else the
    next one due. Free-text rounds can't open a WhatsApp conversation - skipped."""
    from app.models.models import Campaign
    from app.routers.test_send import _campaign_stage, _extra_cols, _resolve_campaign_template
    from shared.domain.messaging import FlowStage
    found = []
    for c in db.query(Campaign).filter(Campaign.event_id == str(event.id)).all():
        if (c.custom_message or "").strip():
            continue
        extras = _extra_cols(db, c.id)
        t = _resolve_campaign_template(db, c, event.event_type, extras.get("campaign_type"))
        if t is not None and t.is_usable and _campaign_stage(c, t, extras.get("campaign_type")) == FlowStage.INVITATION:
            found.append((c, t))
    sent = [f for f in found if (f[0].status or "").lower() in ("sent", "sending")]
    pool = sent or found
    far = dt.datetime.max.replace(tzinfo=dt.timezone.utc)
    pool.sort(key=lambda f: f[0].schedule_time or far, reverse=bool(sent))
    return pool[0] if pool else None


@internal_router.post("/send-invitation")
def send_invitation(body: SendInvitationIn, db: Session = Depends(get_db),
                    x_internal_secret: Optional[str] = Header(None)):
    """The event's invitation, sent to one guest on the priority lane WITH the
    event and guest on the envelope - so the RSVP buttons answer for this guest."""
    require_internal_secret(x_internal_secret)
    from app.models.models import Guest
    from app.routers.test_send import _canonical_phone, _event_dict, publish_outpost_priority
    from shared.domain.messaging import VariableResolver, build_meta_message
    event = event_crud.get_event(db, body.event_id)
    guest = db.query(Guest).filter(Guest.id == body.guest_id, Guest.event_id == body.event_id).first()
    recipient = _canonical_phone(guest.phone) if guest else None
    if event is None or guest is None or not recipient:
        raise HTTPException(404, {"error": "guest_not_found"})
    picked = _invitation_for_resend(db, event)
    if not picked:
        raise HTTPException(409, {"error": "no_invitation_round"})
    c, template = picked
    resolver = VariableResolver(_event_dict(event), header_image_override=c.header_image_url)
    values = resolver.values_for({"name": guest.name, "table_number": getattr(guest, "table_number", None),
                                  "guest_count": guest.guest_count})
    message = build_meta_message(template, values, recipient=recipient, event_id=str(event.id),
                                 campaign_id=None, guest_id=str(guest.id))
    message["source"] = "voice_call"
    try:
        publish_outpost_priority(message)
    except Exception:
        raise HTTPException(503, {"error": "send_unavailable"})
    return {"status": "sent", "template": template.key}
