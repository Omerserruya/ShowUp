"""Public web invitation + open-form RSVP (Phase 16).

UNAUTHENTICATED endpoints (whitelisted in AuthMiddleware via the `/public/`
prefix) that power the shareable web invitation:

- GET  /public/invite/{slug}        -> safe, public view of the invitation design
                                       + event details (NO guest list, owners, or
                                       plan internals).
- POST /public/invite/{slug}/rsvp   -> open-form RSVP. Any visitor submits
                                       name + phone + party size; we upsert a guest
                                       by phone within the event.

Both require the event's invitation to be *published* and the plan tier to include
WEB_INVITATION. Writes are intentionally minimal-trust: deduped by phone, capacity
-checked against the plan limit, and bounded by schema validation. (Rate limiting
at the edge is a tracked follow-up, consistent with the rest of the service.)
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.crud import event as event_crud, guest as guest_crud
from app.schemas.schemas import GuestCreate, PublicRsvpIn
from app.utils import normalize_phone
from app.models.models import Guest
from shared.domain.enums import GuestStatus
from shared.domain.entitlements import Feature, has_feature

router = APIRouter(prefix="/public/invite", tags=["public-invite"])


def _require_published_event(db: Session, slug: str):
    event = event_crud.get_event_by_slug(db, slug)
    # 404 (not 403) for unpublished/missing so we never leak which slugs exist.
    if event is None or not getattr(event, "invitation_published", False):
        raise HTTPException(status_code=404, detail="Invitation not found")
    if not has_feature(getattr(event, "plan_id", None), Feature.WEB_INVITATION):
        raise HTTPException(status_code=404, detail="Invitation not found")
    return event


def _public_event_view(event) -> dict:
    """Whitelist of fields safe to expose on the public page - no PII/guest data."""
    return {
        "slug": event.public_slug,
        "name": event.name,
        "event_date": event.event_date.isoformat() if event.event_date else None,
        "location": event.location,
        "inviters": event.inviters or [],
        "invitation": event.invitation or {},
    }


@router.get("/{slug}")
def get_public_invitation(slug: str, db: Session = Depends(get_db)):
    event = _require_published_event(db, slug)
    return _public_event_view(event)


@router.post("/{slug}/rsvp", status_code=201)
def submit_public_rsvp(slug: str, payload: PublicRsvpIn, db: Session = Depends(get_db)):
    event = _require_published_event(db, slug)

    # Respect the per-invitation RSVP toggle.
    config = event.invitation or {}
    if config.get("rsvpEnabled") is False:
        raise HTTPException(status_code=403, detail="RSVP is closed for this event")

    status = GuestStatus.normalize(payload.status).value
    phone_norm = normalize_phone(payload.phone)
    now = dt.datetime.now(dt.timezone.utc)

    existing = (
        db.query(Guest)
        .filter(Guest.event_id == str(event.id), Guest.phone == phone_norm)
        .first()
    )

    if existing:
        # Returning guest updating their own response - no new capacity consumed.
        existing.name = payload.name or existing.name
        existing.status = status
        if status in GuestStatus.confirmed_values():
            existing.guest_count = payload.party_size
        existing.last_response = now
        if payload.notes:
            existing.notes = payload.notes
        db.add(existing)
        db.commit()
        return {"ok": True, "status": status, "updated": True}

    # New guest via the open form. create_guest enforces the plan capacity limit.
    try:
        guest = guest_crud.create_guest(
            db,
            GuestCreate(
                event_id=event.id,
                name=payload.name,
                phone=phone_norm,
                status=status,
                import_count=payload.party_size,
                guest_count=payload.party_size if status in GuestStatus.confirmed_values() else None,
                notes=payload.notes,
                last_response=now,
            ),
        )
    except ValueError as e:
        # Capacity exceeded or duplicate -> 409 so the page can show a friendly msg.
        raise HTTPException(status_code=409, detail=str(e))

    return {"ok": True, "status": status, "updated": False, "guest_id": str(guest.id)}
