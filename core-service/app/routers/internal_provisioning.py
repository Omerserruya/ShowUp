"""Internal provisioning API - the only route by which an event becomes paid.

Called service-to-service by aub-service AFTER it has verified a payment. Not
exposed through nginx and exempt from the JWT middleware, so every handler
authenticates with `require_internal_secret`.

Why this exists: aub used to provision by calling the PUBLIC `POST /events` and
`PUT /events/{id}` with an ordinary user JWT, passing `plan_id` and
`payment_status` in the body. That made those fields client-writable by
construction - any user could POST the same payload and grant themselves a paid
Pro event. Splitting provisioning onto an internal, secret-authenticated surface
is what lets the public schemas drop the fields entirely.
"""
from __future__ import annotations

import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Path
from sqlalchemy.orm import Session

from app import entitlement_service, provisioning
from app.authz import ensure_personal_account
from app.crud import event as event_crud
from app.db import get_db
from app.internal_auth import require_internal_secret
from shared.domain.enums import EntitlementSource

router = APIRouter(prefix="/internal/provisioning", tags=["internal"])


# Fields aub may supply for a provisioned event. Anything else in the payload is
# ignored - entitlement is decided here, never by the caller's body.
_EVENT_FIELDS = (
    "name",
    "description",
    "event_date",
    "location",
    "inviters",
    "event_type",
    "subjects",
)


def _event_fields(payload: Dict[str, Any]) -> Dict[str, Any]:
    fields = {k: payload.get(k) for k in _EVENT_FIELDS if payload.get(k) is not None}
    if not fields.get("name"):
        raise HTTPException(status_code=422, detail="name is required")
    # `inviters` is stored as a JSON array of {fn, ln} dicts.
    inviters = fields.get("inviters")
    if inviters is not None and not isinstance(inviters, list):
        fields["inviters"] = []
    return fields


@router.post("/events", status_code=201)
def provision_event(
    payload: Dict[str, Any] = Body(...),
    x_internal_secret: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Create a paid, active event for a verified order.

    A payment is now just one entitlement issuer: this mints a PAYMENT
    entitlement and immediately redeems it into the event, so the paid path uses
    the exact same creation and enforcement code as every other source. The
    external contract (aub posts the order + event data, gets an event id back)
    and the idempotency guarantee are unchanged.

    Idempotent on `order_id`: replaying the same order returns the event that was
    already provisioned, with `created: false`, rather than creating a duplicate.
    """
    require_internal_secret(x_internal_secret)

    order_id = str(payload.get("order_id") or "").strip()
    plan_id = str(payload.get("plan_id") or "").strip().lower()
    owner_raw = payload.get("owner_user_id")
    if not order_id:
        raise HTTPException(status_code=422, detail="order_id is required")
    if not plan_id:
        raise HTTPException(status_code=422, detail="plan_id is required")
    if not owner_raw:
        raise HTTPException(status_code=422, detail="owner_user_id is required")
    try:
        owner_user_id = uuid.UUID(str(owner_raw))
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="owner_user_id must be a UUID")

    account_id = ensure_personal_account(db, owner_user_id)
    event, created = entitlement_service.issue_and_redeem(
        db,
        source=EntitlementSource.PAYMENT,
        plan_id=plan_id,
        owner_user_id=owner_user_id,
        account_id=account_id,
        event_fields=_event_fields(payload),
        order_id=order_id,
        metadata={"order_id": order_id},
    )
    return {"id": str(event.id), "created": created}


@router.post("/events/{event_id}/plan")
def provision_plan_change(
    event_id: uuid.UUID = Path(...),
    payload: Dict[str, Any] = Body(default={}),
    x_internal_secret: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    """Apply a purchased plan change (upgrade) to an existing event."""
    require_internal_secret(x_internal_secret)

    plan_id = str(payload.get("plan_id") or "").strip().lower()
    order_id = str(payload.get("order_id") or "").strip()
    if not plan_id:
        raise HTTPException(status_code=422, detail="plan_id is required")

    event = event_crud.get_event(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="event not found")

    event = provisioning.change_plan(db, event, plan_id=plan_id, order_id=order_id)
    return {
        "id": str(event.id),
        "plan_id": event.plan_id,
        "payment_status": event.payment_status,
        "active": event.active,
    }
