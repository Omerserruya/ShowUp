from __future__ import annotations

import uuid
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.models import Guest, Event
from app.schemas.schemas import GuestCreate, GuestUpdate
from app.utils import normalize_phone


def list_guests(
    db: Session,
    event_id: uuid.UUID,
    page: int,
    page_size: int,
    search: Optional[str] = None,
    order_by: Optional[str] = None,
    only_with_responses: bool = False,
    status: Optional[str] = None,
) -> Tuple[List[Guest], int]:
    query = db.query(Guest).filter(Guest.event_id == str(event_id))
    if search:
        like = f"%{search}%"
        query = query.filter((Guest.name.ilike(like)) | (Guest.phone.ilike(like)))
    if status:
        # Map frontend status to backend status
        status_map = {
            'pending': ['invited', 'pending'],
            'confirmed': ['attending', 'confirmed'],
            'declined': ['declined'],
            'maybe': ['maybe']
        }
        if status in status_map:
            query = query.filter(Guest.status.in_(status_map[status]))
    if only_with_responses:
        query = query.filter(Guest.last_response.isnot(None))
    total = query.count()
    # Order by
    if order_by == 'last_response':
        query = query.order_by(Guest.last_response.desc().nulls_last())
    else:
        query = query.order_by(Guest.created_at.desc())
    items = (
        query.offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return items, total


def get_guest(db: Session, guest_id: uuid.UUID) -> Optional[Guest]:
    return db.query(Guest).filter(Guest.id == str(guest_id)).first()


def create_guest(db: Session, data: GuestCreate) -> Guest:
    # ensure event exists
    event = db.query(Event).filter(Event.id == str(data.event_id)).first()
    if not event:
        raise ValueError("event_id does not exist")

    phone_norm = normalize_phone(data.phone)
    # ensure no duplicate phone within same event
    existing = db.query(Guest).filter(Guest.event_id == str(data.event_id), Guest.phone == phone_norm).first()
    if existing:
        raise ValueError("guest phone already exists for this event")

    guest = Guest(
        event_id=str(data.event_id),
        name=data.name,
        phone=phone_norm,
        email=data.email,
        status=data.status,
        group=data.group,
        import_count=data.import_count,
        guest_count=data.guest_count,
        table_number=data.table_number,
        notes=data.notes,
        last_response=data.last_response,
    )
    db.add(guest)
    db.commit()
    db.refresh(guest)
    return guest


def update_guest(db: Session, guest: Guest, data: GuestUpdate) -> Guest:
    if data.name is not None:
        guest.name = data.name
    if data.phone is not None:
        phone_norm = normalize_phone(data.phone)
        dup = db.query(Guest).filter(Guest.event_id == guest.event_id, Guest.phone == phone_norm, Guest.id != guest.id).first()
        if dup:
            raise ValueError("guest phone already exists for this event")
        guest.phone = phone_norm
    if data.email is not None:
        guest.email = data.email
    if data.status is not None:
        guest.status = data.status
        # If status is changed to attending/confirmed and guest_count is None, set it to import_count
        if data.status in ['attending', 'confirmed'] and guest.guest_count is None:
            guest.guest_count = guest.import_count
    if data.group is not None:
        guest.group = data.group
    if data.import_count is not None:
        guest.import_count = data.import_count
    if data.guest_count is not None:
        guest.guest_count = data.guest_count
    if data.table_number is not None:
        guest.table_number = data.table_number
    if data.notes is not None:
        guest.notes = data.notes
    if data.last_response is not None:
        guest.last_response = data.last_response
    db.add(guest)
    db.commit()
    db.refresh(guest)
    return guest


def delete_guest(db: Session, guest: Guest) -> None:
    db.delete(guest)
    db.commit()


def create_guests_bulk(db: Session, event_id: uuid.UUID, items: List[GuestCreate]) -> List[Guest]:
    # ensure event exists
    event = db.query(Event).filter(Event.id == str(event_id)).first()
    if not event:
        raise ValueError("event_id does not exist")

    created: List[Guest] = []
    seen_phones: set[str] = set()
    for data in items:
        phone_norm_val = normalize_phone(data.phone)
        # skip duplicates within the same request payload
        if phone_norm_val in seen_phones:
            continue
        seen_phones.add(phone_norm_val)
        g = Guest(
            event_id=str(event_id),
            name=data.name,
            phone=phone_norm_val,
            email=data.email,
            status=data.status,
            group=data.group,
            import_count=data.import_count,
            guest_count=data.guest_count,
            table_number=data.table_number,
            notes=data.notes,
            last_response=data.last_response,
        )
        # skip duplicates within event
        dup = db.query(Guest).filter(Guest.event_id == str(event_id), Guest.phone == g.phone).first()
        if dup:
            continue
        db.add(g)
        created.append(g)
    db.commit()
    for g in created:
        db.refresh(g)
    return created


def delete_guests_by_event(db: Session, event_id: uuid.UUID) -> int:
    q = db.query(Guest).filter(Guest.event_id == str(event_id))
    count = q.count()
    q.delete(synchronize_session=False)
    db.commit()
    return count


