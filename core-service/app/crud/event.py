from __future__ import annotations

import datetime as dt
import logging
import uuid
from typing import Any, List, Optional, Tuple

from sqlalchemy.orm import Session

from app.models.models import Event, Account
from app.schemas.schemas import EventCreate, EventUpdate
from app import support

logger = logging.getLogger(__name__)

# Small grace so a client clock a few minutes behind, or "today 20:00" typed at
# 19:58, is not rejected.
EVENT_DATE_GRACE = dt.timedelta(minutes=10)
# Campaign statuses that still have a schedule to keep relative to the event.
_SHIFTABLE_CAMPAIGN_STATUSES = ("pending", "paused", "draft")


class EventDateError(ValueError):
    """event_date rejected (in the past / unparseable)."""


def _aware(value: dt.datetime) -> dt.datetime:
    return value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)


def parse_event_date(value: Any) -> Optional[dt.datetime]:
    if value is None or value == "":
        return None
    if isinstance(value, dt.datetime):
        return value
    try:
        return dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise EventDateError("event_date must be an ISO 8601 datetime")


def validate_future_event_date(value: Any) -> None:
    """Reject an event date in the past (create, or an edit that changes it)."""
    parsed = parse_event_date(value)
    if parsed is None:
        return
    if _aware(parsed) < dt.datetime.now(dt.timezone.utc) - EVENT_DATE_GRACE:
        raise EventDateError("event_date must be in the future")


def shift_pending_campaigns(db: Session, event: Event, old_date: Optional[dt.datetime],
                            new_date: Optional[dt.datetime]) -> List[dict]:
    """Move every not-yet-sent campaign with the event (shared round_plan.replan_time):
    the event reminder and the thank-you are recomputed from their rules; every
    other round moves by whole days and keeps its time of day, so "reminder 3
    days before at 12:00" stays exactly that. A campaign that the move would put
    in the past is PAUSED (never fired immediately by surprise); the owner
    reschedules or resumes it explicitly. Caller commits.
    """
    if old_date is None or new_date is None:
        return []
    delta = _aware(new_date) - _aware(old_date)
    if not delta:
        return []
    from app.models.models import Campaign
    now = dt.datetime.now(dt.timezone.utc)
    rows = (
        db.query(Campaign)
        .filter(Campaign.event_id == str(event.id),
                Campaign.status.in_(_SHIFTABLE_CAMPAIGN_STATUSES),
                Campaign.schedule_time.isnot(None))
        .all()
    )
    moved = []
    from shared.domain.messaging import canonical_stage
    from shared.domain.round_plan import replan_time
    for c in rows:
        stage = canonical_stage(c.stage_id) or canonical_stage(c.template)
        stage_id = stage.value if stage else None
        if c.category_id:
            from app.round_categories import get_category
            cat = get_category(db, c.category_id)
            stage_id = cat["base_stage"] if cat else stage_id
        new_time = replan_time(stage_id, _aware(c.schedule_time),
                               _aware(old_date), _aware(new_date))
        c.schedule_time = new_time
        paused = False
        if new_time <= now and c.status == "pending":
            c.status = "paused"
            paused = True
        db.add(c)
        moved.append({"id": str(c.id), "name": c.name, "schedule_time": new_time.isoformat(), "paused": paused})
    if moved:
        logger.info("event %s moved by %s: shifted %d campaign(s) (%d paused)", event.id, delta,
                    len(moved), sum(1 for m in moved if m["paused"]))
    return moved


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

    # A platform admin inside a support session sees that one event alongside
    # their own, so the dashboard's event switcher can select it like any other.
    # Nothing else widens this list - admins are NOT shown every event.
    support_id = support.support_event_id(db, user_id)
    if support_id is not None and not any(str(e.id) == str(support_id) for e in owned):
        supported = next((e for e in all_candidates if str(e.id) == str(support_id)), None)
        if supported is None:
            supported = db.query(Event).filter(Event.id == str(support_id)).first()
        if supported is not None:
            owned = [supported] + owned

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


# The subjects the wizard captures (EventWizard EventSubjects); they feed the
# message variables (couple_names, bride_name, baby_name, company_name ...).
_SUBJECT_TEXT_KEYS = ("p1", "p2", "ln1", "ln2", "honoree", "parent1", "parent2", "company", "bizEventName", "age")
_SUBJECT_ROLES = ("bride", "groom")


class GiftError(ValueError):
    """Invalid gift link / phone (code: gift_url_invalid | gift_phone_invalid)."""


def merge_subjects(current: Optional[dict], patch: dict) -> dict:
    """Owner edit of the event's subjects: known keys only, trimmed short text,
    roles bride|groom; keys not in the patch keep their stored value."""
    out = dict(current or {})
    for k in _SUBJECT_TEXT_KEYS:
        if k in patch:
            out[k] = str(patch[k] or "").strip()[:40]
    for k in ("role1", "role2"):
        if patch.get(k) in _SUBJECT_ROLES:
            out[k] = patch[k]
    if "secretName" in patch:
        out["secretName"] = bool(patch["secretName"])
    return out


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
        old_date = event.event_date
        changed = old_date is None or _aware(data.event_date) != _aware(old_date)
        if changed:
            validate_future_event_date(data.event_date)
            # Re-anchor the campaign plan to the new date (same relative offsets).
            event.shifted_campaigns = shift_pending_campaigns(db, event, old_date, data.event_date)
        event.event_date = data.event_date
    if data.location is not None:
        event.location = data.location
    # `plan_id` / `payment_status` are deliberately NOT updatable here - see the
    # note above EventBase in schemas.py. Plan changes go through
    # app.provisioning.change_plan, driven by a verified paid order.
    if data.subjects is not None:
        event.subjects = merge_subjects(event.subjects, data.subjects)
    if data.gift is not None:
        from shared.domain.gift import merge_gift
        try:
            event.gift = merge_gift(event.gift, data.gift)
        except ValueError as e:
            raise GiftError(str(e))
    if data.seating_layout is not None:
        event.seating_layout = data.seating_layout
    if data.wa_image_url is not None:
        event.wa_image_url = data.wa_image_url or None
    db.add(event)
    db.commit()
    db.refresh(event)
    if data.event_date is not None:
        # An event created before it had a date gets its round plan now (no-op
        # when it already has rounds - those were shifted above instead).
        try:
            from app.default_rounds import ensure_default_rounds
            ensure_default_rounds(db, event)
        except Exception:  # noqa: BLE001
            db.rollback()
            logger.exception("default rounds failed for event %s", event.id)
    return event


def delete_event(db: Session, event: Event) -> None:
    db.delete(event)
    db.commit()


