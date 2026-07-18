from __future__ import annotations

import logging
import os
import uuid
from typing import List, Optional, Tuple

import httpx
from sqlalchemy.orm import Session
from sqlalchemy import func, text

from app.models.models import Guest, Event
from app.schemas.schemas import GuestCreate, GuestUpdate
from app.utils import normalize_phone
from shared.domain.enums import GuestStatus

logger = logging.getLogger(__name__)


def list_guests(
    db: Session,
    event_id: uuid.UUID,
    page: int,
    page_size: int,
    search: Optional[str] = None,
    order_by: Optional[str] = None,
    only_with_responses: bool = False,
    status: Optional[str] = None,
    tag_id: Optional[uuid.UUID] = None,
) -> Tuple[List[Guest], int]:
    query = db.query(Guest).filter(Guest.event_id == str(event_id))
    if tag_id is not None:
        from app.models.models import GuestTag
        query = query.join(GuestTag, GuestTag.guest_id == Guest.id).filter(GuestTag.tag_id == tag_id)
    if search:
        like = f"%{search}%"
        query = query.filter((Guest.name.ilike(like)) | (Guest.phone.ilike(like)))
    if status:
        # Map filter key -> canonical (+legacy) DB values via the shared SSOT.
        status_map = {
            'pending': GuestStatus.pending_values(),
            'confirmed': GuestStatus.confirmed_values(),
            'declined': GuestStatus.declined_values(),
            'maybe': GuestStatus.maybe_values(),
        }
        if status in status_map:
            query = query.filter(Guest.status.in_(list(status_map[status])))
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


def _get_plan_count_limit(plan_id: Optional[str]) -> Optional[int]:
    """
    Fetch count_limit from plan via aub-service API.
    Returns None if plan_id is None, plan not found, or API call fails.
    """
    if not plan_id:
        return None
    
    aub_service_url = os.getenv("AUB_SERVICE_URL", "http://aub-service:8000")
    try:
        with httpx.Client(timeout=2.0) as client:
            # aub exposes /plans/{id} (the /api prefix is an nginx-only rewrite and
            # is NOT present on the service address, so /api/plans/... 404s here).
            response = client.get(f"{aub_service_url}/plans/{plan_id}")
            if response.status_code == 200:
                plan_data = response.json()
                return plan_data.get("countLimit")
            logger.warning(
                "plan count_limit lookup failed: aub returned %s for plan '%s'",
                response.status_code, plan_id,
            )
    except Exception as exc:
        # NOTE (fail-open): a lookup failure currently disables the limit. Hardening
        # this to fail-closed/cache is a separate (Medium) item.
        logger.warning("plan count_limit lookup errored for '%s': %s", plan_id, exc)
    return None


def lock_event_capacity(db: Session, event_id) -> None:
    """Serialize capacity-affecting writes for one event within the current
    transaction (Postgres advisory xact lock, released on commit/rollback). This
    makes the check-then-insert sequence atomic across concurrent requests, so two
    simultaneous RSVPs can't both slip past the plan limit and a double-submit from
    the same guest can't create two rows. No-op-safe on non-Postgres backends."""
    try:
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"guest-cap:{event_id}"})
    except Exception as exc:  # pragma: no cover - only if backend lacks advisory locks
        logger.warning("advisory lock unavailable for event %s: %s", event_id, exc)


def check_capacity_limit(db: Session, event: Event, new_guests_count: int) -> None:
    """
    Check if adding `new_guests_count` (import_count) would exceed the plan's
    count_limit. Raises ValueError if it would. Call INSIDE the advisory lock (see
    `lock_event_capacity`) for the check to be race-free.
    """
    if not event.plan_id:
        # No plan set, no limit enforced
        return

    count_limit = _get_plan_count_limit(event.plan_id)
    if count_limit is None:
        # No limit set for this plan, or couldn't fetch it
        return

    # Count current total guests (sum of import_count)
    current_total = db.query(func.sum(Guest.import_count)).filter(
        Guest.event_id == str(event.id)
    ).scalar() or 0

    if current_total + new_guests_count > count_limit:
        raise ValueError(
            f"Adding {new_guests_count} guests would exceed the plan limit of {count_limit}. "
            f"Current total: {current_total}, limit: {count_limit}"
        )


# Backwards-compatible alias (kept for any external importers).
_check_capacity_limit = check_capacity_limit


def create_guest(db: Session, data: GuestCreate) -> Guest:
    # ensure event exists
    event = db.query(Event).filter(Event.id == str(data.event_id)).first()
    if not event:
        raise ValueError("event_id does not exist")

    # Atomic capacity: lock the event, then check-then-insert in one transaction.
    lock_event_capacity(db, data.event_id)
    check_capacity_limit(db, event, data.import_count or 1)

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
    _maybe_queue_capacity_warning(db, event)
    return guest


def _maybe_queue_capacity_warning(db: Session, event: Event) -> None:
    """Queue a one-time owner WhatsApp warning when the guest list crosses ~90%
    of the plan's capacity. Best-effort - never breaks guest creation. Deduped
    per event via the outbox dedupe_key, so it fires exactly once."""
    try:
        if not event.plan_id:
            return
        limit = _get_plan_count_limit(event.plan_id)
        if not limit:
            return
        used = db.query(func.sum(Guest.import_count)).filter(
            Guest.event_id == str(event.id)
        ).scalar() or 0
        if used < limit * 0.9:
            return
        from app.notifications import queue_owner_notification
        from app.user_directory import resolve_users_by_ids
        owner_ids = [str(o) for o in (event.owners or []) if o]
        directory = resolve_users_by_ids(owner_ids)
        for oid in owner_ids:
            phone = (directory.get(oid) or {}).get("phone")
            if not phone:
                continue
            queue_owner_notification(
                db,
                kind="capacity_warning",
                recipient_phone=phone,
                event_id=event.id,
                params={"1": event.name or "האירוע", "2": str(int(used)), "3": str(int(limit))},
                dedupe_key=f"capacity_warning:{event.id}:{oid}",
            )
    except Exception as exc:  # pragma: no cover - never block guest creation
        logger.warning("capacity warning check failed for event %s: %s", event.id, exc)


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
        # If status changed to a "confirmed" value and guest_count is None, default it.
        if data.status in GuestStatus.confirmed_values() and guest.guest_count is None:
            guest.guest_count = guest.import_count
    if data.group is not None:
        guest.group = data.group
    if data.import_count is not None:
        guest.import_count = data.import_count
    if data.guest_count is not None:
        guest.guest_count = data.guest_count
    # Allow explicitly clearing table_number (null) when client sends table_number in payload
    if "table_number" in data.model_fields_set:
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

    # Calculate total new guests count (sum of import_count)
    total_new_count = sum(item.import_count or 1 for item in items)
    # Check capacity limit before creating any guests
    _check_capacity_limit(db, event, total_new_count)

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


