"""Redeem an entitlement into an event.

Two surfaces:

* `GET /public/redeem/{code}` - UNAUTHENTICATED preview. A logged-out user who
  clicks a redemption link sees WHAT they've been granted (plan, guest cap,
  rounds, expiry) before signing in. It exposes no PII - only the grant - and
  the code is a 256-bit random credential, so it is not an enumeration oracle.

* `POST /redeem/{code}` - AUTHENTICATED redemption. The signed-in user supplies
  their event details and the entitlement is consumed atomically to create the
  one event it authorises. This is the deferred-redemption path (venue link,
  beta code, promo); payment and self-service redeem inline elsewhere.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Path
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import entitlement_service
from app.authz import ensure_personal_account
from app.crud import event as event_crud
from app.db import get_db
from app.entitlement_service import EntitlementNotRedeemable
from app.models.models import Entitlement
from app.schemas.schemas import EventOut, Inviter
from shared.auth.deps import get_current_user_id
from shared.domain.enums import EntitlementStatus

# Unauthenticated preview lives under /public/ (whitelisted in AuthMiddleware).
public_router = APIRouter(prefix="/public/redeem", tags=["redeem"])
# Authenticated redemption is a normal API path (needs a JWT).
router = APIRouter(prefix="/redeem", tags=["redeem"])


class RedeemEventIn(BaseModel):
    """Event details the redeemer supplies. Plan and limits come from the
    entitlement, never from here."""
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None
    event_date: Optional[str] = None
    location: Optional[str] = None
    event_type: Optional[str] = Field(None, validation_alias="eventType", serialization_alias="eventType")
    inviters: Optional[list[Inviter]] = None
    subjects: Optional[dict] = None

    class Config:
        populate_by_name = True


# Machine reason -> HTTP status for a failed redemption. The code holder gets a
# specific reason (they hold the credential, so it is not a leak).
_REASON_STATUS = {
    "not_found": 404,
    "already_redeemed": 409,
    "cancelled": 410,
    "expired": 410,
    "unavailable": 409,
}


@public_router.get("/{code}")
def preview_entitlement(code: str = Path(..., max_length=64), db: Session = Depends(get_db)):
    """What a redemption link grants. Public; reveals the grant, never PII."""
    ent = db.query(Entitlement).filter(Entitlement.code == code).first()
    if ent is None:
        return {"redeemable": False, "reason": "not_found"}
    status = entitlement_service.effective_status(ent)
    return {
        "redeemable": status == EntitlementStatus.AVAILABLE,
        "status": status.value,
        "source": ent.source,
        "plan_id": ent.plan_id,
        "max_guests": ent.max_guests,
        "campaign_rounds": ent.campaign_rounds,
        "expires_at": ent.expires_at.isoformat() if ent.expires_at else None,
    }


@router.post("/{code}", response_model=EventOut, status_code=201)
def redeem_entitlement(
    code: str = Path(..., max_length=64),
    payload: RedeemEventIn = Body(...),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Consume the entitlement and create its event, owned by the caller."""
    account_id = ensure_personal_account(db, user_id)
    event_fields = payload.model_dump(exclude_none=True, by_alias=False)
    # Inviters arrive as pydantic models; store as plain dicts.
    if event_fields.get("inviters"):
        event_fields["inviters"] = [
            {"fn": i.fn, "ln": i.ln} if isinstance(i, Inviter) else i
            for i in payload.inviters or []
        ]
    try:
        event = entitlement_service.redeem(
            db, code=code, owner_user_id=user_id,
            event_fields=event_fields, account_id=account_id,
        )
    except EntitlementNotRedeemable as exc:
        raise HTTPException(
            status_code=_REASON_STATUS.get(exc.reason, 409),
            detail={"code": f"entitlement_{exc.reason}"},
        )
    except entitlement_service.EntitlementError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    event_crud.annotate_venue(db, [event])
    return event
