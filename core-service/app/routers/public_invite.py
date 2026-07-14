"""Public web invitation + open-form RSVP (Phase 16).

UNAUTHENTICATED endpoints (whitelisted in AuthMiddleware via the `/public/`
prefix) that power the shareable web invitation:

- GET  /public/invite/{slug}        -> safe, public view of the invitation design
                                       + event details (NO guest list, owners, or
                                       plan internals).
- POST /public/invite/{slug}/rsvp   -> open-form RSVP. Any visitor submits
                                       name + phone + party size; we upsert a guest
                                       by phone within the event.

Both require the event's invitation to be *published* (the web invitation is
included in every plan). Writes are intentionally minimal-trust: deduped by phone,
capacity-checked against the plan's guest limit, and bounded by schema validation. (Rate limiting
at the edge is a tracked follow-up, consistent with the rest of the service.)
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.crud import event as event_crud, guest as guest_crud
from app.schemas.schemas import GuestCreate, PublicRsvpIn
from app.utils import normalize_phone
from app.models.models import Guest
from shared.domain.enums import GuestStatus

router = APIRouter(prefix="/public/invite", tags=["public-invite"])


class RsvpLookupIn(BaseModel):
    phone: str = Field(..., min_length=4, max_length=32)


def _require_published_event(db: Session, slug: str):
    event = event_crud.get_event_by_slug(db, slug)
    # 404 (not 403) for unpublished/missing so we never leak which slugs exist.
    if event is None or not getattr(event, "invitation_published", False):
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


@router.post("/{slug}/rsvp/lookup")
def lookup_public_rsvp(slug: str, payload: RsvpLookupIn, db: Session = Depends(get_db)):
    """Return a returning guest's existing RSVP (by phone) so the invitation page
    can pre-fill and let them UPDATE instead of creating a duplicate. Scoped to the
    event; returns only that guest's own fields (no other guests are exposed)."""
    event = _require_published_event(db, slug)
    phone_norm = normalize_phone(payload.phone)
    g = (
        db.query(Guest)
        .filter(Guest.event_id == str(event.id), Guest.phone == phone_norm)
        .first()
    )
    if not g:
        return {"found": False}
    return {
        "found": True,
        "name": g.name,
        "status": g.status,
        "party_size": g.import_count,
        "notes": g.notes,
    }


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
    party = payload.party_size

    # Atomic critical section: serialize every capacity-affecting write for this
    # event. This makes the check-then-write race-free - two guests confirming at
    # once can't both exceed the limit, and a double-submit from the same phone
    # updates one row instead of creating a duplicate.
    guest_crud.lock_event_capacity(db, event.id)
    existing = (
        db.query(Guest)
        .filter(Guest.event_id == str(event.id), Guest.phone == phone_norm)
        .first()
    )

    if existing:
        # Returning guest: only an INCREASE in party size consumes new capacity.
        old = existing.import_count or 0
        delta = max(0, party - old)
        if delta:
            try:
                guest_crud.check_capacity_limit(db, event, delta)
            except ValueError as e:
                raise HTTPException(status_code=409, detail=str(e))
        existing.name = payload.name or existing.name
        existing.status = status
        existing.import_count = party
        existing.guest_count = party if status in GuestStatus.confirmed_values() else None
        existing.last_response = now
        if payload.notes:
            existing.notes = payload.notes
        db.add(existing)
        db.commit()
        return {"ok": True, "status": status, "updated": True, "party_size": party}

    # New guest via the open form. create_guest re-checks capacity under the same
    # advisory lock (re-entrant) before inserting.
    try:
        guest = guest_crud.create_guest(
            db,
            GuestCreate(
                event_id=event.id,
                name=payload.name,
                phone=phone_norm,
                status=status,
                import_count=party,
                guest_count=party if status in GuestStatus.confirmed_values() else None,
                notes=payload.notes,
                last_response=now,
            ),
        )
    except ValueError as e:
        # Capacity exceeded or duplicate -> 409 so the page can show a friendly msg.
        raise HTTPException(status_code=409, detail=str(e))

    return {"ok": True, "status": status, "updated": False, "guest_id": str(guest.id), "party_size": party}
