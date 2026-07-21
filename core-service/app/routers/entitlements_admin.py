"""Admin entitlement management - issue, list, expire, cancel, inspect.

The back-office surface for the beta program, promotions, partner deals and
manual grants. Every endpoint is admin-gated (DB role). Issuing here is exactly
the same `entitlement_service.issue()` the venue pool and payment paths use -
there is no admin-only minting logic.
"""
from __future__ import annotations

import datetime as dt
import uuid
from typing import Any, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import entitlement_service, user_directory
from app.audit import record_audit
from app.db import get_db
from app.models.models import Entitlement
from shared.auth.admin import get_admin_user_id
from shared.domain.enums import ActorType, EntitlementSource, EntitlementStatus

router = APIRouter(prefix="/admin/entitlements", tags=["admin-entitlements"])

# Sources an admin may mint. PAYMENT is excluded - a payment entitlement may only
# be created by the verified-payment path, never granted by hand.
_ADMIN_SOURCES = {
    EntitlementSource.BETA, EntitlementSource.ADMIN,
    EntitlementSource.PROMOTION, EntitlementSource.PARTNER,
}

# A single generate call is capped so a typo can't mint tens of thousands of rows.
_MAX_BATCH = 500


class EntitlementCreateIn(BaseModel):
    source: str = Field(..., description="beta | admin | promotion | partner")
    plan_id: str = Field(..., max_length=50)
    count: int = Field(1, ge=1, le=_MAX_BATCH)
    max_guests: Optional[int] = Field(None, ge=1)
    campaign_rounds: Optional[int] = Field(None, ge=0)
    expires_at: Optional[dt.datetime] = None
    metadata: Optional[dict] = None


@router.post("", status_code=201)
def create_entitlements(
    payload: EntitlementCreateIn = Body(...),
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    """Mint a batch of entitlements and return them with their redemption links."""
    try:
        source = EntitlementSource.normalize(payload.source)
    except ValueError:
        raise HTTPException(status_code=422, detail="unknown source")
    if source not in _ADMIN_SOURCES:
        raise HTTPException(status_code=400, detail="that source cannot be issued from the admin console")

    created: List[Entitlement] = []
    for _ in range(payload.count):
        ent = entitlement_service.issue(
            db, source=source, plan_id=payload.plan_id, created_by=admin_id,
            max_guests=payload.max_guests, campaign_rounds=payload.campaign_rounds,
            expires_at=payload.expires_at, metadata=payload.metadata, commit=False,
        )
        created.append(ent)
    db.commit()
    for ent in created:
        db.refresh(ent)
    record_audit(db, actor_type=ActorType.USER, actor_id=admin_id, account_id=None,
                 action="admin.entitlements_issued", entity_type="entitlement", entity_id=None,
                 data={"source": source.value, "plan_id": payload.plan_id, "count": payload.count})
    return {"count": len(created),
            "entitlements": [entitlement_service.to_dict(e, include_code=True) for e in created]}


@router.get("")
def list_entitlements(
    status: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    account_id: Optional[uuid.UUID] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    """List entitlements, newest first, with optional status/source/account filter."""
    q = db.query(Entitlement)
    if status:
        q = q.filter(Entitlement.status == status.strip().lower())
    if source:
        q = q.filter(Entitlement.source == source.strip().lower())
    if account_id:
        q = q.filter(Entitlement.account_id == account_id)
    total = q.count()
    rows = (q.order_by(Entitlement.created_at.desc())
            .offset((page - 1) * page_size).limit(page_size).all())

    # Resolve redeemer names in one batch (owners live in aub).
    redeemer_ids = [str(r.redeemed_by_user_id) for r in rows if r.redeemed_by_user_id]
    names = user_directory.resolve_users_by_ids(
        [uuid.UUID(i) for i in set(redeemer_ids)]) if redeemer_ids else {}

    items = []
    for r in rows:
        d = entitlement_service.to_dict(r, include_code=True)
        redeemer = names.get(str(r.redeemed_by_user_id)) if r.redeemed_by_user_id else None
        d["redeemed_by_name"] = (
            f"{(redeemer or {}).get('first_name') or ''} {(redeemer or {}).get('last_name') or ''}".strip()
            or None
        ) if redeemer else None
        items.append(d)
    return {"total": total, "page": page, "page_size": page_size, "items": items}


@router.get("/{entitlement_id}")
def get_entitlement(
    entitlement_id: uuid.UUID,
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    ent = db.query(Entitlement).filter(Entitlement.id == entitlement_id).first()
    if not ent:
        raise HTTPException(status_code=404, detail="entitlement not found")
    return entitlement_service.to_dict(ent, include_code=True)


@router.post("/{entitlement_id}/expire")
def expire_entitlement(
    entitlement_id: uuid.UUID,
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    return _transition(db, entitlement_id, EntitlementStatus.EXPIRED, admin_id)


@router.post("/{entitlement_id}/cancel")
def cancel_entitlement(
    entitlement_id: uuid.UUID,
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    return _transition(db, entitlement_id, EntitlementStatus.CANCELLED, admin_id)


def _transition(db: Session, entitlement_id: uuid.UUID, target: EntitlementStatus, admin_id: uuid.UUID):
    ent = db.query(Entitlement).filter(Entitlement.id == entitlement_id).first()
    if not ent:
        raise HTTPException(status_code=404, detail="entitlement not found")
    try:
        ent = entitlement_service.set_status(db, ent, target)
    except entitlement_service.EntitlementError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    record_audit(db, actor_type=ActorType.USER, actor_id=admin_id, account_id=ent.account_id,
                 action=f"admin.entitlement_{target.value}", entity_type="entitlement", entity_id=ent.id,
                 data={})
    return entitlement_service.to_dict(ent, include_code=True)
