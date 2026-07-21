from __future__ import annotations

import uuid
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.models import Event, Account
from app.schemas.schemas import EventCreate, EventUpdate


def annotate_venue(db: Session, events: List[Event]) -> List[Event]:
    """Attach the derived `is_venue` / `venue_name` attributes read by EventOut.

    An event bound to a partner-venue Account is "Venue Edition": we surface the
    venue's name so the UI can show "Provided by <Venue>". These are transient
    attributes on the ORM instance (not columns), always set so EventOut never
    serializes stale/missing values. Non-venue events get is_venue=False.
    """
    if not events:
        return events
    account_ids = {e.account_id for e in events if getattr(e, "account_id", None)}
    venues: dict = {}
    if account_ids:
        rows = (
            db.query(Account)
            .filter(Account.id.in_(account_ids), Account.type == "venue")
            .all()
        )
        venues = {a.id: a for a in rows}
    for e in events:
        venue = venues.get(getattr(e, "account_id", None))
        e.is_venue = bool(venue)
        e.venue_name = venue.name if venue else None
    return events


def is_owner(event: Event, user_id: uuid.UUID) -> bool:
    try:
        return str(user_id) in {str(u) for u in (event.owners or [])}
    except Exception:
        return False


def list_events_for_user(
    db: Session,
    user_id: uuid.UUID,
    page: int,
    page_size: int,
    search: Optional[str] = None,
) -> Tuple[List[Event], int]:
    query = db.query(Event)
    if search:
        query = query.filter(Event.name.ilike(f"%{search}%"))

    # Fetch and filter by ownership in application layer for portability
    all_candidates = query.order_by(Event.created_at.desc()).all()
    owned = [e for e in all_candidates if is_owner(e, user_id)]
    total = len(owned)
    start = (page - 1) * page_size
    end = start + page_size
    return owned[start:end], total


def get_event(db: Session, event_id: uuid.UUID) -> Optional[Event]:
    return db.query(Event).filter(Event.id == event_id).first()


def get_event_by_slug(db: Session, slug: str) -> Optional[Event]:
    """Lookup an event by its public invitation slug (used by the public, no-auth
    invitation/RSVP endpoints)."""
    if not slug:
        return None
    return db.query(Event).filter(Event.public_slug == slug).first()


# NOTE: event CREATION no longer lives here. Every event - free or paid, self-
# service or venue - is now created by redeeming an entitlement
# (`app.entitlement_service`), so there is a single event-construction path and
# no way to build an event without consuming an entitlement. This module keeps
# only reads and non-entitlement updates.


def update_event(db: Session, event: Event, data: EventUpdate) -> Event:
    # `owners` is not accepted here - ownership changes go through the members
    # API, which enforces its own guards. See the note on EventUpdate.
    if data.inviters is not None:
        # Convert inviters from Pydantic models to dicts for JSON storage
        event.inviters = [{"fn": inviter.fn, "ln": inviter.ln} for inviter in data.inviters]
    if data.name is not None:
        event.name = data.name
    if data.description is not None:
        event.description = data.description
    if data.event_date is not None:
        event.event_date = data.event_date
    if data.location is not None:
        event.location = data.location
    # `plan_id` / `payment_status` are deliberately NOT updatable here - see the
    # note above EventBase in schemas.py. Plan changes go through
    # app.provisioning.change_plan, driven by a verified paid order.
    if data.seating_layout is not None:
        event.seating_layout = data.seating_layout
    if data.wa_image_url is not None:
        event.wa_image_url = data.wa_image_url or None
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def delete_event(db: Session, event: Event) -> None:
    db.delete(event)
    db.commit()


