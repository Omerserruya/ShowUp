"""Venue Edition (B2B2C) endpoints.

A *venue* is an `Account` with `type='venue'` that owns many events, each for a
different event owner (couple / family / company). Venue-admin users are linked
to the venue Account through an OWNER `Membership` (created at provisioning).

This router lets a venue admin:
  - list the venues they administer (`GET /venues/mine`),
  - see the events under a venue + capacity usage (`GET /venues/{id}/events`),
  - create a new event for an owner, consuming one capacity slot and sending a
    WhatsApp welcome (`POST /venues/{id}/events`).

Owner users live in aub-service, so owner creation + the welcome message are
delegated to aub via `app.user_directory` (internal, secret-guarded calls).

Also exposes one internal endpoint (`GET /internal/events/{id}/partner`) so
aub-service can resolve the per-venue partner coupon when an owner upgrades.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Path
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.crud import event as event_crud
from app.models.models import Account, Membership, Event, Guest
from app.schemas.schemas import EventCreate, EventOut
from app import user_directory
from app.audit import record_audit
from shared.auth.deps import get_current_user_id
from shared.domain.enums import ActorType
from shared.domain.roles import Role

logger = logging.getLogger(__name__)


router = APIRouter(tags=["venues"])


# ---- helpers ---------------------------------------------------------------

def _load_venue(db: Session, venue_id: uuid.UUID) -> Account:
    venue = (
        db.query(Account)
        .filter(Account.id == venue_id, Account.type == "venue")
        .first()
    )
    if not venue:
        # 404 (not 403) so we never leak which account ids are venues.
        raise HTTPException(status_code=404, detail="Not found")
    return venue


def _require_venue_admin(db: Session, venue_id: uuid.UUID, user_id: uuid.UUID) -> Account:
    """The venue Account, or 404 unless the caller is an active member of it.
    A suspended venue is blocked (403) from all venue-admin actions."""
    venue = _load_venue(db, venue_id)
    member = (
        db.query(Membership)
        .filter(
            Membership.account_id == venue_id,
            Membership.user_id == user_id,
            Membership.status == "active",
        )
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="Not found")
    if getattr(venue, "status", "active") == "suspended":
        raise HTTPException(status_code=403, detail="This venue is suspended. Contact ShowUp support.")
    return venue


def _month_start() -> datetime:
    now = datetime.utcnow()
    return datetime(now.year, now.month, 1)


def _events_used(db: Session, venue_id: uuid.UUID) -> int:
    """Lifetime events for the venue (all-time total, for stats)."""
    return db.query(Event).filter(Event.account_id == venue_id).count()


def _events_used_month(db: Session, venue_id: uuid.UUID) -> int:
    """Events created in the current calendar month - the figure the monthly
    subscription capacity is enforced against (slots reset each month)."""
    return (
        db.query(Event)
        .filter(Event.account_id == venue_id, Event.created_at >= _month_start())
        .count()
    )


# ---- venue admin: list venues ---------------------------------------------

@router.get("/venues/mine")
def my_venues(db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    """Venues the caller administers (member of a `type='venue'` Account). Empty
    list for a normal event owner - the frontend uses this to gate the /venue area."""
    account_ids = [
        m.account_id
        for m in db.query(Membership)
        .filter(Membership.user_id == user_id, Membership.status == "active")
        .all()
    ]
    if not account_ids:
        return []
    venues = (
        db.query(Account)
        .filter(Account.id.in_(account_ids), Account.type == "venue")
        .all()
    )
    out = []
    for v in venues:
        used_month = _events_used_month(db, v.id)
        out.append({
            "id": str(v.id),
            "name": v.name,
            "status": getattr(v, "status", "active"),
            "event_capacity": v.event_capacity,          # monthly allowance (None = unlimited)
            "events_used": used_month,                   # used THIS month
            "events_used_total": _events_used(db, v.id), # lifetime, for stats
            "events_remaining": None if v.event_capacity is None else max(0, v.event_capacity - used_month),
            "has_partner_coupon": bool(v.partner_coupon_code),
        })
    return out


# ---- venue admin: list the venue's events ---------------------------------

@router.get("/venues/{venue_id}/events")
def venue_events(
    venue_id: uuid.UUID = Path(...),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    _require_venue_admin(db, venue_id, user_id)
    events = (
        db.query(Event)
        .filter(Event.account_id == venue_id)
        .order_by(Event.created_at.desc())
        .all()
    )
    if not events:
        return []

    event_ids = [e.id for e in events]
    # Total guests + confirmed guests per event, in two grouped queries.
    total_counts = dict(
        db.query(Guest.event_id, func.count(Guest.id))
        .filter(Guest.event_id.in_(event_ids))
        .group_by(Guest.event_id)
        .all()
    )
    confirmed_counts = dict(
        db.query(Guest.event_id, func.count(Guest.id))
        .filter(Guest.event_id.in_(event_ids), Guest.status.in_(["attending", "confirmed"]))
        .group_by(Guest.event_id)
        .all()
    )

    # Owner display names (owners live in aub-service).
    owner_ids = []
    for e in events:
        for o in (e.owners or []):
            owner_ids.append(o)
    names = user_directory.resolve_users_by_ids([uuid.UUID(str(o)) for o in owner_ids]) if owner_ids else {}

    out = []
    for e in events:
        first_owner = (e.owners or [None])[0]
        owner = names.get(str(first_owner)) if first_owner else None
        owner_name = None
        if owner:
            owner_name = f"{owner.get('first_name') or ''} {owner.get('last_name') or ''}".strip() or None
        out.append({
            "id": str(e.id),
            "name": e.name,
            "event_type": e.event_type,
            "event_date": e.event_date.isoformat() if e.event_date else None,
            "plan_id": e.plan_id,
            "public_slug": e.public_slug,
            "invitation_published": bool(e.invitation_published),
            "owner_name": owner_name,
            "owner_phone": owner.get("phone") if owner else None,
            "total_guests": int(total_counts.get(e.id, 0)),
            "confirmed_guests": int(confirmed_counts.get(e.id, 0)),
        })
    return out


# ---- venue admin: create an event -----------------------------------------

class VenueEventCreate(BaseModel):
    event_type: Optional[str] = None
    name: str = Field(..., max_length=100)
    event_date: Optional[datetime] = None
    location: Optional[str] = None
    owner_first_name: str = Field(..., max_length=100)
    owner_last_name: Optional[str] = Field("", max_length=100)
    owner_phone: str = Field(..., max_length=20)
    owner_email: Optional[str] = None


@router.post("/venues/{venue_id}/events", response_model=EventOut, status_code=201)
def create_venue_event(
    venue_id: uuid.UUID = Path(...),
    payload: VenueEventCreate = Body(...),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Create a Venue Edition event for an owner. Consumes one capacity slot,
    creates/links the owner account (by phone) in aub-service, and fires a
    WhatsApp welcome. The event gets plan_id='venue' and is owned by the owner
    (via the `owners` array) while belonging to the venue Account."""
    venue = _require_venue_admin(db, venue_id, user_id)

    # Hard quota: block once the venue's MONTHLY subscription capacity is used up
    # (slots reset at the start of each calendar month).
    if venue.event_capacity is not None and _events_used_month(db, venue_id) >= venue.event_capacity:
        raise HTTPException(
            status_code=409,
            detail="מכסת האירועים החודשית של האולם מלאה. פנו ל-ShowUp כדי להגדיל את המכסה.",
        )

    # Ensure the OWNER user exists in aub (create-or-get by phone).
    owner = user_directory.ensure_user_by_phone(
        payload.owner_phone,
        payload.owner_first_name,
        payload.owner_last_name or "",
        payload.owner_email,
    )
    if not owner or not owner.get("user_id"):
        raise HTTPException(status_code=502, detail="לא ניתן ליצור את חשבון בעל האירוע")
    owner_id = uuid.UUID(str(owner["user_id"]))

    # Create the event owned by the couple, on the Venue Edition tier.
    event = event_crud.create_event(
        db,
        EventCreate(
            owners=[owner_id],
            name=payload.name,
            event_type=payload.event_type,
            event_date=payload.event_date,
            location=payload.location,
            plan_id="venue",
            payment_status="paid",
        ),
    )
    # Bind to the venue Account (drives the venue dashboard + partner-discount
    # detection). We deliberately do NOT create an owner Membership - per-event
    # isolation comes from the owners array (see authz.resolve_role), so one
    # couple can't see another couple's event under the same venue.
    event.account_id = venue_id
    db.add(event)
    db.commit()
    db.refresh(event)

    # Premium-service WhatsApp welcome (best-effort; never fails event creation).
    try:
        user_directory.notify_venue_welcome(
            phone=payload.owner_phone,
            venue_name=venue.name or "האולם",
            event_id=str(event.id),
            first_name=payload.owner_first_name,
        )
    except Exception:
        pass

    event_crud.annotate_venue(db, [event])
    return event


# ---- internal: partner coupon lookup (called by aub-service) ---------------

def _check_internal_secret(x_internal_secret: Optional[str]) -> None:
    expected = os.getenv("INTERNAL_API_SECRET")
    if not expected:
        # Misconfiguration, not an attack: without the secret the partner-coupon
        # lookup always fails and the venue discount silently never applies. Log
        # loudly and return a distinct 503 so it's diagnosable.
        logger.error(
            "INTERNAL_API_SECRET is not set on core-service; rejecting internal "
            "partner lookup. Venue partner discounts are disabled until it is set."
        )
        raise HTTPException(status_code=503, detail="internal auth not configured")
    if x_internal_secret != expected:
        raise HTTPException(status_code=403, detail="forbidden")


@router.get("/internal/events/{event_id}/partner")
def internal_event_partner(
    event_id: uuid.UUID = Path(...),
    x_internal_secret: str = Header(None),
    db: Session = Depends(get_db),
):
    """Internal: resolve an event's checkout context for aub.

    Returns the event's authoritative current ``plan_id`` (so aub derives the
    purchase type - new purchase vs upgrade - from server truth, never the
    client), plus the venue partner-discount config (``is_venue`` / ``venue_name``
    / ``partner_coupon_code``). Any field may be null (unknown event / non-venue).
    """
    _check_internal_secret(x_internal_secret)
    event = event_crud.get_event(db, event_id)
    if not event:
        return {"plan_id": None, "is_venue": False, "venue_name": None, "partner_coupon_code": None}
    plan_id = getattr(event, "plan_id", None)
    venue = None
    if getattr(event, "account_id", None):
        venue = (
            db.query(Account)
            .filter(Account.id == event.account_id, Account.type == "venue")
            .first()
        )
    if not venue:
        return {"plan_id": plan_id, "is_venue": False, "venue_name": None, "partner_coupon_code": None}
    return {
        "plan_id": plan_id,
        "is_venue": True,
        "venue_name": venue.name,
        "partner_coupon_code": venue.partner_coupon_code,
    }


@router.get("/internal/events/{event_id}/extra-round-quote")
def internal_extra_round_quote(
    event_id: uuid.UUID = Path(...),
    audience: str = "everyone",
    x_internal_secret: str = Header(None),
    db: Session = Depends(get_db),
):
    """Internal: authoritative extra-round quote for an event (called by aub).

    Returns the event's plan, the recipient count for the audience, and the
    VAT-inclusive price - all computed server-side so aub never trusts a client
    price. `everyone` is the default and typical audience for a new round."""
    _check_internal_secret(x_internal_secret)
    event = event_crud.get_event(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="event not found")
    from app.audience import count_audience
    from shared.domain.rounds import extra_round_price
    from app.plans_client import plan_extra_round_bands
    recipients = count_audience(db, event_id, audience, None)
    # Per-plan extra-round pricing (plans.json `extra_round_prices`).
    price = extra_round_price(recipients, plan_extra_round_bands(getattr(event, "plan_id", None)))
    return {
        "event_id": str(event_id),
        "plan_id": getattr(event, "plan_id", None),
        "event_name": getattr(event, "name", None),
        "recipients": recipients,
        "price_gross": price["price_gross"],
        "band_label": price["band_label"],
    }


@router.post("/internal/events/{event_id}/rounds-allowance")
def internal_grant_rounds_allowance(
    event_id: uuid.UUID = Path(...),
    payload: Dict[str, Any] = Body(default={}),
    x_internal_secret: str = Header(None),
    db: Session = Depends(get_db),
):
    """Internal: grant paid extra message-round credits to an event.

    Called by aub-service when a paid extra-round order is provisioned. Increments
    ``events.extra_rounds_allowance`` by ``delta`` (default 1). Idempotency is the
    caller's responsibility (provision_order runs once per order)."""
    _check_internal_secret(x_internal_secret)
    event = event_crud.get_event(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="event not found")
    try:
        delta = int(payload.get("delta", 1))
    except (TypeError, ValueError):
        delta = 1
    if delta <= 0:
        delta = 1
    event.extra_rounds_allowance = int(getattr(event, "extra_rounds_allowance", 0) or 0) + delta
    db.add(event)
    db.commit()
    db.refresh(event)
    return {"event_id": str(event_id), "extra_rounds_allowance": event.extra_rounds_allowance}


# ==========================================================================
# Venue Console: settings, users, coupon, branding, stats (venue-admin gated)
# ==========================================================================

# Roles a venue admin may assign to venue team members (never OWNER: no transfer).
VENUE_ASSIGNABLE = {"manager", "viewer"}


def _venue_detail(db: Session, venue: Account) -> dict:
    used_month = _events_used_month(db, venue.id)
    return {
        "id": str(venue.id),
        "name": venue.name,
        "billing_email": venue.billing_email,
        "status": getattr(venue, "status", "active"),
        "event_capacity": venue.event_capacity,
        "events_used": used_month,
        "events_used_total": _events_used(db, venue.id),
        "events_remaining": None if venue.event_capacity is None else max(0, venue.event_capacity - used_month),
        "partner_coupon_code": venue.partner_coupon_code,
        "branding": venue.branding or {},
    }


@router.get("/venues/{venue_id}")
def get_venue(venue_id: uuid.UUID = Path(...), db: Session = Depends(get_db),
              user_id: uuid.UUID = Depends(get_current_user_id)):
    """Venue detail for the settings screen (capacity, coupon, branding, status)."""
    venue = _require_venue_admin(db, venue_id, user_id)
    return _venue_detail(db, venue)


class VenueSelfUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    billing_email: Optional[str] = Field(None, max_length=100)
    partner_coupon_code: Optional[str] = Field(None, max_length=50)
    branding: Optional[dict] = None


@router.patch("/venues/{venue_id}")
def update_venue_self(venue_id: uuid.UUID = Path(...), payload: VenueSelfUpdate = Body(...),
                      db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    """Venue admin edits their own venue: display name, billing email, partner
    coupon, and branding. (Capacity/plan/status stay admin-only.) The coupon code
    is stored as-is; it only yields a discount if present in aub COUPONS_JSON."""
    venue = _require_venue_admin(db, venue_id, user_id)
    fields = payload.model_dump(exclude_unset=True)
    if "name" in fields and fields["name"] is not None:
        venue.name = fields["name"].strip() or venue.name
    if "billing_email" in fields:
        venue.billing_email = fields["billing_email"]
    if "partner_coupon_code" in fields:
        code = (fields["partner_coupon_code"] or "").strip().upper() or None
        venue.partner_coupon_code = code
    if "branding" in fields:
        venue.branding = fields["branding"]
    db.add(venue)
    db.commit()
    db.refresh(venue)
    record_audit(db, account_id=venue.id, actor_type=ActorType.USER, actor_id=user_id,
                 action="venue.settings_updated", entity_type="account", entity_id=venue.id,
                 data={"fields": list(fields.keys())})
    return _venue_detail(db, venue)


# ---- venue users & roles --------------------------------------------------

@router.get("/venues/{venue_id}/members")
def list_venue_members(venue_id: uuid.UUID = Path(...), db: Session = Depends(get_db),
                       user_id: uuid.UUID = Depends(get_current_user_id)):
    """Team members who administer this venue (active memberships)."""
    _require_venue_admin(db, venue_id, user_id)
    members = (
        db.query(Membership)
        .filter(Membership.account_id == venue_id, Membership.status == "active")
        .all()
    )
    directory = user_directory.resolve_users_by_ids([m.user_id for m in members]) if members else {}
    out = []
    for m in members:
        info = directory.get(str(m.user_id), {})
        name = (f"{info.get('first_name','')} {info.get('last_name','')}".strip() or None) if info else None
        out.append({
            "membership_id": str(m.id),
            "user_id": str(m.user_id),
            "role": m.role,
            "name": name,
            "phone": info.get("phone") if info else None,
            "is_self": m.user_id == user_id,
        })
    return out


class VenueMemberInvite(BaseModel):
    phone: str = Field(..., max_length=20)
    first_name: Optional[str] = Field(None, max_length=100)
    last_name: Optional[str] = Field("", max_length=100)
    role: str = Field("manager", max_length=20)


@router.post("/venues/{venue_id}/members", status_code=201)
def invite_venue_member(venue_id: uuid.UUID = Path(...), payload: VenueMemberInvite = Body(...),
                        db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    """Add a team member to the venue by phone (creating their user if needed).
    Role limited to manager/viewer - ownership is never transferable here."""
    _require_venue_admin(db, venue_id, user_id)
    role = payload.role if payload.role in VENUE_ASSIGNABLE else "manager"
    # Resolve or create the user in aub.
    info = user_directory.resolve_user_id_by_phone(payload.phone)
    if not info:
        info = user_directory.ensure_user_by_phone(
            payload.phone, payload.first_name or "", payload.last_name or "", None
        )
    if not info or not info.get("user_id"):
        raise HTTPException(status_code=502, detail="Could not resolve or create that user")
    member_uid = uuid.UUID(str(info["user_id"]))
    existing = (
        db.query(Membership)
        .filter(Membership.account_id == venue_id, Membership.user_id == member_uid)
        .first()
    )
    if existing:
        if existing.status == "active":
            raise HTTPException(status_code=409, detail="already_member")
        existing.status = "active"
        existing.role = role
        db.add(existing)
        db.commit()
        m = existing
    else:
        m = Membership(account_id=venue_id, user_id=member_uid, role=role, status="active")
        db.add(m)
        db.commit()
        db.refresh(m)
    record_audit(db, account_id=venue_id, actor_type=ActorType.USER, actor_id=user_id,
                 action="venue.member_added", entity_type="membership", entity_id=m.id,
                 data={"role": role, "phone": payload.phone})
    return {"membership_id": str(m.id), "user_id": str(member_uid), "role": m.role}


@router.delete("/venues/{venue_id}/members/{membership_id}", status_code=204)
def remove_venue_member(venue_id: uuid.UUID = Path(...), membership_id: uuid.UUID = Path(...),
                        db: Session = Depends(get_db), user_id: uuid.UUID = Depends(get_current_user_id)):
    """Remove a venue team member (soft: status='suspended'). The venue OWNER and
    self cannot be removed here."""
    _require_venue_admin(db, venue_id, user_id)
    m = (
        db.query(Membership)
        .filter(Membership.id == membership_id, Membership.account_id == venue_id)
        .first()
    )
    if not m:
        raise HTTPException(status_code=404, detail="Not found")
    if m.role == Role.OWNER.value:
        raise HTTPException(status_code=400, detail="cannot_remove_owner")
    if m.user_id == user_id:
        raise HTTPException(status_code=400, detail="cannot_remove_self")
    m.status = "suspended"
    db.add(m)
    db.commit()
    record_audit(db, account_id=venue_id, actor_type=ActorType.USER, actor_id=user_id,
                 action="venue.member_removed", entity_type="membership", entity_id=m.id)
    return None


# ---- upgrade statistics (placeholder aggregation) -------------------------

@router.get("/venues/{venue_id}/stats")
def venue_stats(venue_id: uuid.UUID = Path(...), db: Session = Depends(get_db),
                user_id: uuid.UUID = Depends(get_current_user_id)):
    """Venue-level rollup for the dashboard + upgrade-stats placeholder: totals
    across all the venue's events, and how many owners upgraded past Venue Edition
    (a paid plan_id). Kept intentionally simple; richer analytics come later."""
    _require_venue_admin(db, venue_id, user_id)
    events = db.query(Event).filter(Event.account_id == venue_id).all()
    total_events = len(events)
    published = sum(1 for e in events if getattr(e, "invitation_published", False))
    # "Upgraded" = event moved off Venue Edition onto a real paid plan.
    upgraded = sum(1 for e in events if (e.plan_id or "venue") not in ("venue", "free", None))
    event_ids = [e.id for e in events]
    total_guests = 0
    confirmed_guests = 0
    if event_ids:
        total_guests = int(
            db.query(func.coalesce(func.sum(Guest.import_count), 0))
            .filter(Guest.event_id.in_(event_ids)).scalar() or 0
        )
        confirmed_guests = int(
            db.query(func.count(Guest.id))
            .filter(Guest.event_id.in_(event_ids), Guest.status.in_(["attending", "confirmed"])).scalar() or 0
        )
    return {
        "total_events": total_events,
        "published_events": published,
        "upgraded_events": upgraded,          # upgrade-stats placeholder
        "upgrade_rate": round(upgraded / total_events, 3) if total_events else 0.0,
        "total_guests": total_guests,
        "confirmed_guests": confirmed_guests,
    }
