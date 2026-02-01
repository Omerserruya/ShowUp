from __future__ import annotations

import uuid
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.models import Event
from app.schemas.schemas import EventCreate, EventUpdate


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


def create_event(db: Session, data: EventCreate) -> Event:
    # Ensure owners is a list of strings, not UUID objects
    owners_list = []
    if data.owners:
        owners_list = [str(owner) for owner in data.owners]
    
    # Convert inviters from Pydantic models to dicts for JSON storage
    inviters_list = []
    if data.inviters:
        inviters_list = [{"fn": inviter.fn, "ln": inviter.ln} for inviter in data.inviters]
    
    print(f"[CREATE_EVENT] Creating event: name={data.name}, location type={type(data.location)}, location value={data.location}")
    print(f"[CREATE_EVENT] Location length: {len(data.location) if data.location else 0}")
    
    event = Event(
        owners=owners_list,
        inviters=inviters_list,
        name=data.name,
        description=data.description,
        event_date=data.event_date,
        location=data.location,
        plan_id=data.plan_id,
        seating_layout=None,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    
    print(f"[CREATE_EVENT] Event created: id={event.id}, location in DB={event.location}")
    print(f"[CREATE_EVENT] Location in DB type={type(event.location)}, length={len(event.location) if event.location else 0}")
    
    return event


def update_event(db: Session, event: Event, data: EventUpdate) -> Event:
    if data.owners is not None:
        event.owners = [str(owner) for owner in data.owners]
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
    if data.plan_id is not None:
        event.plan_id = data.plan_id
    if data.seating_layout is not None:
        event.seating_layout = data.seating_layout
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def delete_event(db: Session, event: Event) -> None:
    db.delete(event)
    db.commit()


