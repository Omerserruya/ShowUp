from __future__ import annotations

import logging
import os
import uuid
import re
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy.orm import Session
from sqlalchemy import func, text

from app.models.models import Guest, Event
from app.plans_client import PlanLookupUnavailable, plan_count_limit
from app.schemas.schemas import GuestCreate, GuestUpdate
from app.utils import normalize_phone
from shared.domain.enums import GuestStatus

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Phone canonicalization
# ---------------------------------------------------------------------------
# Guests used to be stored in whatever format they arrived in (0501234567 /
# +972501234567 / 972-50-...), so the same person could be added twice and
# duplicate detection depended on how the number was typed. Every write path
# here stores E.164 (+972... for Israeli local numbers) and every duplicate
# check compares canonical digits on BOTH sides (shared canonical_phone_sql),
# so rows written before this change still match.

def canonical_phone(phone: Any) -> Optional[str]:
    """E.164 form of `phone`, or None when it is not a plausible phone number.

    0501234567 / 050-123-4567 / 501234567 / 972501234567 / +972 50 123 4567 /
    00972501234567 -> +972501234567. Other international numbers keep their
    digits (+14155550100). Excel cells arrive as int/float (leading 0 lost,
    '.0' suffix) - both handled.
    """
    if phone is None:
        return None
    if isinstance(phone, float):
        if phone != phone or not phone.is_integer():  # NaN / fractional
            return None
        phone = int(phone)
    text_val = str(phone).strip()
    if not text_val:
        return None
    if re.fullmatch(r"\d+\.0+", text_val):
        text_val = text_val.split(".", 1)[0]
    has_plus = text_val.startswith("+")
    d = re.sub(r"\D", "", text_val)
    if not d:
        return None
    if d.startswith("00"):
        d = d[2:]
    elif d.startswith("0"):
        d = "972" + d[1:]
    elif not has_plus and len(d) == 9 and d[0] in "5":
        d = "972" + d
    elif not has_plus and len(d) == 8 and d[0] in "234689":
        d = "972" + d  # landline whose leading 0 Excel dropped
    if d.startswith("9720"):
        d = "972" + d[4:]
    if d.startswith("972"):
        if len(d) - 3 not in (8, 9):
            return None
    elif not (8 <= len(d) <= 15):
        return None
    return f"+{d}"


def _canonical_digits_sql() -> str:
    from shared.domain.delivery import canonical_phone_sql
    return canonical_phone_sql("phone")


def existing_canonical_phones(db: Session, event_id) -> set:
    """Canonical digits (no '+') of every guest phone already in the event."""
    rows = db.execute(
        text(f"SELECT {_canonical_digits_sql()} FROM guests WHERE event_id = CAST(:e AS uuid)"),
        {"e": str(event_id)},
    ).fetchall()
    return {r[0] for r in rows if r[0]}


def phone_exists_in_event(db: Session, event_id, phone_e164: str, exclude_guest_id=None) -> bool:
    digits = (phone_e164 or "").lstrip("+")
    sql = f"SELECT 1 FROM guests WHERE event_id = CAST(:e AS uuid) AND {_canonical_digits_sql()} = :d"
    params: Dict[str, Any] = {"e": str(event_id), "d": digits}
    if exclude_guest_id is not None:
        sql += " AND id <> CAST(:x AS uuid)"
        params["x"] = str(exclude_guest_id)
    return db.execute(text(sql + " LIMIT 1"), params).first() is not None


class DuplicatePhoneError(ValueError):
    """The phone already belongs to a guest of this event."""


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


# Guest capacity is resolved by app.entitlement_service.effective_max_guests:
# the event's per-event override (from its entitlement) if set, else the plan's
# cap via app.plans_client (fail-CLOSED). One implementation, one cache.


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


def check_capacity_limit(
    db: Session, event: Event, new_guests_count: int, *, exclude_guest_id=None
) -> None:
    """
    Check whether adding `new_guests_count` seats would exceed the plan's
    count_limit. Raises ValueError if it would. Call INSIDE the advisory lock (see
    `lock_event_capacity`) for the check to be race-free.

    `exclude_guest_id` omits one guest from the current total, so an UPDATE can
    be checked as "replace this guest's seats with N" rather than "add N on top".
    """
    if new_guests_count <= 0:
        return  # freeing or keeping capacity never needs a check

    from app.entitlement_service import effective_max_guests
    count_limit = effective_max_guests(event)
    if count_limit is None:
        return  # genuinely unmetered (entitlement override or plan says so)

    q = db.query(func.sum(Guest.import_count)).filter(Guest.event_id == str(event.id))
    if exclude_guest_id is not None:
        q = q.filter(Guest.id != exclude_guest_id)
    current_total = q.scalar() or 0

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

    # E.164 when recognisable; legacy normalization otherwise so no caller that
    # used to succeed starts failing on an odd format.
    phone_norm = canonical_phone(data.phone) or normalize_phone(data.phone)
    # ensure no duplicate phone within same event - format-insensitive
    if phone_exists_in_event(db, data.event_id, phone_norm):
        raise DuplicatePhoneError("guest phone already exists for this event")

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
        from app.entitlement_service import effective_max_guests
        try:
            limit = effective_max_guests(event)
        except Exception:
            return  # a plan-lookup blip must never break guest creation
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
    # Raising a guest's seat count consumes plan capacity exactly like creating
    # guests does. Without this check, the cap was trivially bypassed by adding
    # one guest and then PATCHing import_count to an arbitrary number.
    if data.import_count is not None and data.import_count > (guest.import_count or 0):
        event = db.query(Event).filter(Event.id == str(guest.event_id)).first()
        if event:
            lock_event_capacity(db, guest.event_id)
            # Checked as a replacement, not an addition: this guest's existing
            # seats are released back before the new total is tested.
            check_capacity_limit(db, event, data.import_count, exclude_guest_id=guest.id)

    if data.name is not None:
        guest.name = data.name
    if data.phone is not None:
        phone_norm = canonical_phone(data.phone) or normalize_phone(data.phone)
        if phone_exists_in_event(db, guest.event_id, phone_norm, exclude_guest_id=guest.id):
            raise DuplicatePhoneError("guest phone already exists for this event")
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
    # Lock BEFORE checking: without it two concurrent imports both pass the
    # check and both insert, overshooting the cap. Same pattern as create_guest.
    lock_event_capacity(db, event_id)
    check_capacity_limit(db, event, total_new_count)

    created: List[Guest] = []
    seen_phones: set[str] = set()
    existing_phones = existing_canonical_phones(db, event_id)
    for data in items:
        phone_norm_val = canonical_phone(data.phone) or normalize_phone(data.phone)
        # skip duplicates within the same request payload / already in the event
        digits = phone_norm_val.lstrip("+")
        if digits in seen_phones or digits in existing_phones:
            continue
        seen_phones.add(digits)
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
        db.add(g)
        created.append(g)
    db.commit()
    for g in created:
        db.refresh(g)
    return created


def _clean_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    out = str(value).strip()
    return out or None


def _positive_int(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    try:
        n = int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None
    return n if n >= 1 else None


def import_guest_rows(db: Session, event: Event, rows: List[Tuple[int, Dict[str, Any]]],
                      *, dry_run: bool = False) -> Dict[str, Any]:
    """File import that never aborts on one bad row.

    `rows` = [(row_number, {name, phone, email?, group?, import_count?,
    table_number?})]. Each row is either created or reported:
      * skipped_invalid     - missing name / unusable phone / bad field
      * skipped_duplicates  - phone already in the event or repeated in the file
      * capacity_reached    - the plan's guest cap was hit; rows from there on
                              are not imported (`skipped_capacity` counts them)
    All created guests are committed together under the event capacity lock.
    `dry_run` runs the exact same checks and writes nothing (import preview);
    `guests` then holds {row, name, phone} of the rows that WOULD be created.
    """
    from app.entitlement_service import effective_max_guests

    lock_event_capacity(db, event.id)
    limit = effective_max_guests(event)
    used = db.query(func.sum(Guest.import_count)).filter(Guest.event_id == str(event.id)).scalar() or 0
    remaining = None if limit is None else max(0, int(limit) - int(used))

    existing = existing_canonical_phones(db, event.id)
    seen: Dict[str, int] = {}
    created: List[Guest] = []
    would_create: List[Dict[str, Any]] = []
    skipped_duplicates: List[Dict[str, Any]] = []
    skipped_invalid: List[Dict[str, Any]] = []
    capacity_reached = False
    skipped_capacity = 0

    for row_no, raw in rows:
        name = _clean_str(raw.get("name"))
        phone_raw = _clean_str(raw.get("phone"))
        if not name and not phone_raw:
            continue  # blank line - not worth reporting
        if not name:
            skipped_invalid.append({"row": row_no, "phone": phone_raw, "reason": "חסר שם"})
            continue
        if not phone_raw:
            skipped_invalid.append({"row": row_no, "name": name, "reason": "חסר מספר טלפון"})
            continue
        phone = canonical_phone(raw.get("phone"))
        if not phone:
            skipped_invalid.append({"row": row_no, "name": name, "phone": phone_raw,
                                    "reason": "מספר טלפון לא תקין"})
            continue
        digits = phone.lstrip("+")
        if digits in existing:
            skipped_duplicates.append({"row": row_no, "name": name, "phone": phone,
                                       "reason": "already_in_event"})
            continue
        if digits in seen:
            skipped_duplicates.append({"row": row_no, "name": name, "phone": phone,
                                       "reason": "repeated_in_file", "first_row": seen[digits]})
            continue
        if capacity_reached:
            skipped_capacity += 1
            continue
        seats = _positive_int(raw.get("import_count")) or 1
        if remaining is not None and seats > remaining:
            capacity_reached = True
            skipped_capacity += 1
            continue
        email = _clean_str(raw.get("email"))
        group = _clean_str(raw.get("group"))
        table = _positive_int(raw.get("table_number"))
        if table is not None and table > 128:
            table = None
        try:
            data = GuestCreate(event_id=event.id, name=name[:100], phone=phone, email=email,
                               group=group[:100] if group else None, import_count=seats,
                               table_number=table)
        except Exception:
            # Almost always a malformed email - keep the guest, drop that field.
            try:
                data = GuestCreate(event_id=event.id, name=name[:100], phone=phone,
                                   group=group[:100] if group else None, import_count=seats,
                                   table_number=table)
            except Exception as e:  # pragma: no cover - defensive
                skipped_invalid.append({"row": row_no, "name": name, "phone": phone_raw,
                                        "reason": f"שורה לא תקינה ({str(e)[:80]})"})
                continue
        seen[digits] = row_no
        if remaining is not None:
            remaining -= seats
        if dry_run:
            would_create.append({"row": row_no, "name": data.name, "phone": phone,
                                 "group": data.group, "import_count": seats})
            continue
        g = Guest(
            event_id=str(event.id), name=data.name, phone=phone, email=data.email,
            status=data.status, group=data.group, import_count=data.import_count,
            table_number=data.table_number,
        )
        db.add(g)
        created.append(g)

    report_tail = {
        "skipped_duplicates": skipped_duplicates,
        "skipped_invalid": skipped_invalid,
        "capacity_reached": capacity_reached,
        "skipped_capacity": skipped_capacity,
        "capacity_limit": limit,
    }
    if dry_run:
        db.rollback()  # releases the advisory lock; nothing was added
        return {"created": len(would_create), "dry_run": True, **report_tail, "guests": would_create}

    db.commit()
    for g in created:
        db.refresh(g)
    if created:
        _maybe_queue_capacity_warning(db, event)
    return {
        "created": len(created),
        "skipped_duplicates": skipped_duplicates,
        "skipped_invalid": skipped_invalid,
        "capacity_reached": capacity_reached,
        "skipped_capacity": skipped_capacity,
        "capacity_limit": limit,
        "dry_run": False,
        "guests": created,
    }


def delete_guests_by_event(db: Session, event_id: uuid.UUID) -> int:
    q = db.query(Guest).filter(Guest.event_id == str(event_id))
    count = q.count()
    q.delete(synchronize_session=False)
    db.commit()
    return count


