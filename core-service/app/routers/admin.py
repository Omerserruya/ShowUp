"""
Admin API endpoints – event management (core-service).
All endpoints require admin role.
"""
from __future__ import annotations

import datetime as dt
import uuid
from typing import Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.models import Event, Guest, Campaign, Account, Membership, AuditLog, FeatureFlag
from app import user_directory
from app.audit import record_audit
from app.authz import ensure_personal_account
from shared.auth.admin import get_admin_user_id
from shared.domain.roles import Role
from shared.domain.enums import ActorType, EntitlementSource, PaymentStatus
from app.provisioning import DEFAULT_SELF_SERVICE_PLAN, apply_entitlement
from app import entitlement_service

router = APIRouter(prefix="/admin", tags=["admin"])


def _event_to_dict(event: Event) -> dict:
    return {
        "id": str(event.id),
        "name": event.name,
        "description": event.description,
        "event_date": event.event_date.isoformat() if event.event_date else None,
        "location": event.location,
        "active": event.active,
        "owners": event.owners or [],
        "inviters": event.inviters or [],
        "plan_id": event.plan_id,
        "event_type": getattr(event, "event_type", None),
        "state": getattr(event, "state", None),
        "payment_status": getattr(event, "payment_status", None),
        "created_at": event.created_at.isoformat() if event.created_at else None,
        "updated_at": event.updated_at.isoformat() if event.updated_at else None,
    }


def _guest_to_dict(guest: Guest) -> dict:
    return {
        "id": str(guest.id),
        "event_id": str(guest.event_id),
        "name": guest.name,
        "phone": guest.phone,
        "email": guest.email,
        "group": guest.group,
        "status": guest.status,
        "import_count": guest.import_count,
        "guest_count": guest.guest_count,
        "table_number": guest.table_number,
        "notes": guest.notes,
        "created_at": guest.created_at.isoformat() if guest.created_at else None,
    }


def _campaign_to_dict(campaign: Campaign) -> dict:
    return {
        "id": str(campaign.id),
        "event_id": str(campaign.event_id),
        "name": campaign.name,
        "template": campaign.template,
        "channel": campaign.channel,
        "schedule_time": campaign.schedule_time.isoformat() if campaign.schedule_time else None,
        "status": campaign.status,
        "recipient_count": campaign.recipient_count,
        "created_at": campaign.created_at.isoformat() if campaign.created_at else None,
        "updated_at": campaign.updated_at.isoformat() if campaign.updated_at else None,
    }


# ---------------------------------------------------------------------------
# Venue (B2B2C) provisioning – create/list partner venues + their admins
# ---------------------------------------------------------------------------

class VenueCreate(BaseModel):
    name: str
    # NULL = unlimited events on the venue's subscription.
    event_capacity: Optional[int] = None
    # Partner discount coupon auto-applied to owners' upgrades (must exist in the
    # aub COUPONS_JSON catalogue to actually yield a discount). Defaults to the
    # env DEFAULT_VENUE_COUPON when null.
    partner_coupon_code: Optional[str] = None
    # The venue admin who will manage events (logs in via OTP with this phone).
    admin_phone: str
    admin_first_name: Optional[str] = "האולם"
    admin_last_name: Optional[str] = ""


def _venue_to_dict(db: Session, v: Account) -> dict:
    used = db.query(Event).filter(Event.account_id == v.id).count()
    return {
        "id": str(v.id),
        "name": v.name,
        "type": v.type,
        "status": getattr(v, "status", "active"),
        "event_capacity": v.event_capacity,
        "events_used": used,
        "partner_coupon_code": v.partner_coupon_code,
        "branding": v.branding or {},
        "created_at": v.created_at.isoformat() if v.created_at else None,
    }


@router.get("/venues")
def list_venues(db: Session = Depends(get_db), admin_id: uuid.UUID = Depends(get_admin_user_id)):
    venues = db.query(Account).filter(Account.type == "venue").order_by(Account.created_at.desc()).all()
    return {"venues": [_venue_to_dict(db, v) for v in venues]}


@router.post("/venues", status_code=201)
def create_venue(
    payload: VenueCreate = Body(...),
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    """Provision a partner venue: a venue Account + an OWNER membership for the
    admin user (created-by-phone in aub if needed, so they can log in via OTP)."""
    owner = user_directory.ensure_user_by_phone(
        payload.admin_phone,
        payload.admin_first_name or "האולם",
        payload.admin_last_name or "",
        None,
    )
    if not owner or not owner.get("user_id"):
        raise HTTPException(status_code=502, detail="Could not create/resolve the venue admin user")
    admin_user_id = uuid.UUID(str(owner["user_id"]))

    venue = Account(
        name=payload.name,
        type="venue",
        event_capacity=payload.event_capacity,
        partner_coupon_code=(payload.partner_coupon_code or None),
    )
    db.add(venue)
    db.flush()  # assign venue.id

    # OWNER membership so the admin can manage all of the venue's events.
    exists = (
        db.query(Membership)
        .filter(Membership.account_id == venue.id, Membership.user_id == admin_user_id)
        .first()
    )
    if not exists:
        db.add(Membership(
            account_id=venue.id, user_id=admin_user_id, role=Role.OWNER.value, status="active",
        ))
    db.commit()
    db.refresh(venue)
    return _venue_to_dict(db, venue)


class VenueUpdate(BaseModel):
    name: Optional[str] = None
    event_capacity: Optional[int] = None   # monthly allowance; None = unlimited
    partner_coupon_code: Optional[str] = None
    status: Optional[str] = None            # 'active' | 'suspended'


@router.put("/venues/{venue_id}")
def update_venue(
    venue_id: uuid.UUID,
    payload: VenueUpdate = Body(...),
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    venue = db.query(Account).filter(Account.id == venue_id, Account.type == "venue").first()
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")
    data = payload.model_dump(exclude_unset=True)
    if data.get("status") and data["status"] not in ("active", "suspended"):
        raise HTTPException(status_code=400, detail="status must be 'active' or 'suspended'")
    for key in ("name", "event_capacity", "partner_coupon_code", "status"):
        if key in data:
            setattr(venue, key, data[key])
    db.add(venue)
    db.commit()
    db.refresh(venue)
    record_audit(db, actor_type=ActorType.USER, actor_id=admin_id, account_id=venue.id,
                 action="admin.venue_updated", entity_type="account", entity_id=venue.id,
                 data={"fields": list(data.keys()), **({"status": data["status"]} if "status" in data else {})})
    return _venue_to_dict(db, venue)


@router.delete("/venues/{venue_id}")
def delete_venue(
    venue_id: uuid.UUID,
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    """Delete a partner venue. ON DELETE CASCADE removes its memberships, events
    (and everything under them), tags, usage_events and wa_templates."""
    venue = db.query(Account).filter(Account.id == venue_id, Account.type == "venue").first()
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")
    events_used = db.query(Event).filter(Event.account_id == venue.id).count()
    # Audit BEFORE delete (commit=False) so both land in one transaction.
    record_audit(db, actor_type=ActorType.USER, actor_id=admin_id, account_id=venue.id,
                 action="admin.venue_deleted", entity_type="account", entity_id=venue.id,
                 data={"name": venue.name, "events_deleted": events_used}, commit=False)
    db.delete(venue)
    db.commit()
    return {"status": "deleted"}


class AdminEventCreate(BaseModel):
    name: str
    event_type: Optional[str] = None
    event_date: Optional[dt.datetime] = None
    location: Optional[str] = None
    # paid=True comps the event (skips the payment flow) by marking it settled.
    # paid=False leaves it PENDING, which - because `active` is derived from
    # settlement - means the event is created inactive until it is paid for.
    paid: bool = True
    # Plan the comped event runs on. Defaults to the free starter tier; an
    # explicit paid plan is how an admin grants a higher guest cap / round count.
    # Never leave this NULL: an unset plan is treated as unmetered downstream.
    plan_id: Optional[str] = None
    # Event OWNER (the customer). Give a phone to create/resolve that user and make
    # them the owner. Falls back to owner_user_id, then the acting admin.
    owner_phone: Optional[str] = None
    owner_first_name: Optional[str] = None
    owner_last_name: Optional[str] = None
    owner_email: Optional[str] = None
    owner_user_id: Optional[uuid.UUID] = None


@router.post("/events", status_code=201)
def admin_create_event(
    payload: AdminEventCreate = Body(...),
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    """Create an event directly (admin/back-office), skipping the wizard + payment.
    When `owner_phone` is given, the owner user is created/resolved in aub and set
    as the event owner. The `paid` toggle only sets payment_status; features are
    unlocked regardless (plan_id NULL => fully entitled)."""
    # Resolve the owner: create the user from the given phone, else an explicit id,
    # else fall back to the acting admin.
    if payload.owner_phone and payload.owner_phone.strip():
        owner = user_directory.ensure_user_by_phone(
            payload.owner_phone.strip(),
            (payload.owner_first_name or "").strip() or "בעל/ת האירוע",
            (payload.owner_last_name or "").strip(),
            (payload.owner_email or "").strip() or None,
        )
        if not owner or not owner.get("user_id"):
            raise HTTPException(status_code=502, detail="Could not create/resolve the event owner user")
        owner_id = uuid.UUID(str(owner["user_id"]))
    else:
        owner_id = payload.owner_user_id or admin_id
    # An admin creating an event directly is an ADMIN entitlement issuer: the
    # event is GRANTED, so it is settled (active) on the chosen plan. This routes
    # through the same issue+redeem path as every other source - there is no
    # admin-only event-creation code. (The `paid` flag is retained for API
    # compatibility but an admin-granted event is settled by definition.)
    account_id = ensure_personal_account(db, owner_id)
    event, _ = entitlement_service.issue_and_redeem(
        db,
        source=EntitlementSource.ADMIN,
        plan_id=(payload.plan_id or DEFAULT_SELF_SERVICE_PLAN),
        owner_user_id=owner_id,
        account_id=account_id,
        created_by=admin_id,
        event_fields={
            "name": payload.name,
            "event_type": payload.event_type,
            "event_date": payload.event_date,
            "location": payload.location,
        },
        metadata={"created_via": "admin_direct"},
    )
    record_audit(db, actor_type=ActorType.USER, actor_id=admin_id, account_id=event.account_id,
                 action="admin.event_created", entity_type="event", entity_id=event.id,
                 data={"owner_user_id": str(owner_id), "entitlement_id": str(event.entitlement_id)})
    return _event_to_dict(event)


# ---------------------------------------------------------------------------
# GET /admin/events – list ALL events (paginated, searchable)
# ---------------------------------------------------------------------------
@router.get("/events")
def list_events(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query(""),
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    query = db.query(Event)
    if search:
        query = query.filter(Event.name.ilike(f"%{search}%"))
    total = query.count()
    events = query.order_by(Event.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    result = []
    for event in events:
        d = _event_to_dict(event)
        d["guest_count"] = db.query(Guest).filter(Guest.event_id == event.id).count()
        d["campaign_count"] = db.query(Campaign).filter(Campaign.event_id == event.id).count()
        result.append(d)

    return {"events": result, "total": total, "page": page, "page_size": page_size}


# ---------------------------------------------------------------------------
# GET /admin/events/{event_id} – get any event (no ownership check)
# ---------------------------------------------------------------------------
@router.get("/events/{event_id}")
def get_event(
    event_id: str,
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    d = _event_to_dict(event)
    d["guest_count"] = db.query(Guest).filter(Guest.event_id == event.id).count()
    d["campaign_count"] = db.query(Campaign).filter(Campaign.event_id == event.id).count()
    return d


# ---------------------------------------------------------------------------
# PUT /admin/events/{event_id} – update any event
# ---------------------------------------------------------------------------
@router.put("/events/{event_id}")
def update_event(
    event_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    allowed = {"name", "description", "event_date", "location", "active"}
    for key in allowed:
        if key in payload:
            setattr(event, key, payload[key])

    db.add(event)
    db.commit()
    db.refresh(event)
    return _event_to_dict(event)


# ---------------------------------------------------------------------------
# DELETE /admin/events/{event_id} – delete any event
# ---------------------------------------------------------------------------
@router.delete("/events/{event_id}")
def delete_event(
    event_id: str,
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    db.delete(event)
    db.commit()
    return {"status": "deleted"}


# ---------------------------------------------------------------------------
# GET /admin/events/{event_id}/guests – list guests for any event
# ---------------------------------------------------------------------------
@router.get("/events/{event_id}/guests")
def list_event_guests(
    event_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    query = db.query(Guest).filter(Guest.event_id == event_id)
    total = query.count()
    guests = query.order_by(Guest.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"guests": [_guest_to_dict(g) for g in guests], "total": total}


# ---------------------------------------------------------------------------
# GET /admin/events/{event_id}/campaigns – list campaigns for any event
# ---------------------------------------------------------------------------
@router.get("/events/{event_id}/campaigns")
def list_event_campaigns(
    event_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    query = db.query(Campaign).filter(Campaign.event_id == event_id)
    total = query.count()
    campaigns = query.order_by(Campaign.created_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {"campaigns": [_campaign_to_dict(c) for c in campaigns], "total": total}


# ===========================================================================
# System Admin Console: dashboard, monitoring, audit, feature flags
# ===========================================================================

@router.get("/stats")
def system_stats(db: Session = Depends(get_db), admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Dashboard overview: platform-wide counts. Users live in aub, so the
    console fetches user/subscription counts from aub separately."""
    from sqlalchemy import func as _f
    venues_total = db.query(_f.count(Account.id)).filter(Account.type == "venue").scalar() or 0
    venues_suspended = db.query(_f.count(Account.id)).filter(Account.type == "venue", Account.status == "suspended").scalar() or 0
    events_total = db.query(_f.count(Event.id)).scalar() or 0
    events_active = db.query(_f.count(Event.id)).filter(Event.state == "active").scalar() or 0
    events_published = db.query(_f.count(Event.id)).filter(Event.invitation_published == True).scalar() or 0  # noqa: E712
    guests_total = int(db.query(_f.coalesce(_f.sum(Guest.import_count), 0)).scalar() or 0)
    campaigns_total = db.query(_f.count(Campaign.id)).scalar() or 0
    return {
        "venues": {"total": int(venues_total), "suspended": int(venues_suspended), "active": int(venues_total) - int(venues_suspended)},
        "events": {"total": int(events_total), "active": int(events_active), "published": int(events_published)},
        "guests": {"total": guests_total},
        "campaigns": {"total": int(campaigns_total)},
    }


@router.get("/audit-log")
def audit_log(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    action: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    """Recent privileged actions (append-only), newest first."""
    q = db.query(AuditLog)
    if action:
        q = q.filter(AuditLog.action == action)
    total = q.count()
    rows = q.order_by(AuditLog.occurred_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    return {
        "total": total,
        "entries": [{
            "id": str(r.id),
            "account_id": str(r.account_id) if r.account_id else None,
            "actor_type": r.actor_type,
            "actor_id": str(r.actor_id) if r.actor_id else None,
            "action": r.action,
            "entity_type": r.entity_type,
            "entity_id": str(r.entity_id) if r.entity_id else None,
            "data": r.data,
            "occurred_at": r.occurred_at.isoformat() if r.occurred_at else None,
        } for r in rows],
    }


@router.get("/health")
def system_health(admin_id: uuid.UUID = Depends(get_admin_user_id), db: Session = Depends(get_db)):
    """Operational monitoring: message-broker queue depths + messaging throughput.
    Best-effort - each probe degrades to an error field instead of failing the call."""
    import os
    queues: dict = {}
    try:
        import httpx
        host = os.getenv("RABBITMQ_HOST", "rabbitmq")
        mgmt_port = int(os.getenv("RABBITMQ_MANAGEMENT_PORT", "15672"))
        user = os.getenv("RABBITMQ_USER") or os.getenv("RABBITMQ_DEFAULT_USER", "guest")
        pw = os.getenv("RABBITMQ_PASSWORD") or os.getenv("RABBITMQ_DEFAULT_PASS", "guest")
        r = httpx.get(f"http://{host}:{mgmt_port}/api/queues", auth=(user, pw), timeout=4.0)
        if r.status_code == 200:
            for q in r.json():
                queues[q.get("name")] = {
                    "messages": q.get("messages", 0),
                    "consumers": q.get("consumers", 0),
                    "messages_unacknowledged": q.get("messages_unacknowledged", 0),
                }
        else:
            queues = {"error": f"management API {r.status_code}"}
    except Exception as exc:  # pragma: no cover
        queues = {"error": str(exc)}

    # Messaging health from the sent-messages ledger (best-effort; tables may vary).
    messaging: dict = {}
    from sqlalchemy import text as _t
    for label, sql in (
        ("sent_total", "SELECT count(*) FROM messages_sent"),
        ("sent_24h", "SELECT count(*) FROM messages_sent WHERE created_at >= now() - interval '24 hours'"),
    ):
        try:
            messaging[label] = int(db.execute(_t(sql)).scalar() or 0)
        except Exception:
            db.rollback()
            messaging[label] = None
    return {"queues": queues, "messaging": messaging}


# ---- feature flags --------------------------------------------------------

class FeatureFlagUpsert(BaseModel):
    enabled: bool
    description: Optional[str] = None


@router.get("/feature-flags")
def list_feature_flags(db: Session = Depends(get_db), admin_id: uuid.UUID = Depends(get_admin_user_id)):
    flags = db.query(FeatureFlag).order_by(FeatureFlag.key).all()
    return {"flags": [{
        "key": f.key, "enabled": f.enabled, "description": f.description,
        "updated_at": f.updated_at.isoformat() if f.updated_at else None,
    } for f in flags]}


@router.put("/feature-flags/{key}")
def upsert_feature_flag(
    key: str,
    payload: FeatureFlagUpsert = Body(...),
    db: Session = Depends(get_db),
    admin_id: uuid.UUID = Depends(get_admin_user_id),
):
    """Toggle (create-or-update) a global feature flag from the admin console."""
    flag = db.query(FeatureFlag).filter(FeatureFlag.key == key).first()
    if flag is None:
        flag = FeatureFlag(key=key, enabled=payload.enabled, description=payload.description, updated_by=admin_id)
        db.add(flag)
    else:
        flag.enabled = payload.enabled
        if payload.description is not None:
            flag.description = payload.description
        flag.updated_by = admin_id
    db.commit()
    record_audit(db, actor_type=ActorType.USER, actor_id=admin_id,
                 action="admin.feature_flag_set", entity_type="feature_flag",
                 data={"key": key, "enabled": payload.enabled})
    return {"key": key, "enabled": payload.enabled, "description": flag.description}


# ---- delivery planner monitoring ------------------------------------------
# Reads the planner-service's DB snapshot directly (shared Postgres) so the data
# is exposed through the admin-gated console rather than the planner-service's own
# internal API - keeps every admin surface behind the same RBAC.

@router.get("/planner")
def planner_overview(db: Session = Depends(get_db), admin_id: uuid.UUID = Depends(get_admin_user_id)):
    """Latest planner run + live release-queue depth. Degrades gracefully to an
    'idle' shape if the planner-service has not run yet (tables absent/empty)."""
    from sqlalchemy import text as _t

    def _scalar_rows(sql, mapper):
        try:
            return [mapper(r) for r in db.execute(_t(sql)).mappings().all()]
        except Exception:
            db.rollback()
            return []

    # latest run snapshot
    last_run = None
    try:
        row = db.execute(_t(
            "SELECT ran_at, strategy, total_planned, total_moved, total_unplaced, "
            "delayed_campaigns, estimated_completion, metrics "
            "FROM planner_runs ORDER BY ran_at DESC LIMIT 1"
        )).mappings().first()
        if row:
            last_run = {
                "ran_at": row["ran_at"].isoformat() if row["ran_at"] else None,
                "strategy": row["strategy"],
                "total_planned": row["total_planned"],
                "total_moved": row["total_moved"],
                "total_unplaced": row["total_unplaced"],
                "delayed_campaigns": row["delayed_campaigns"],
                "estimated_completion": row["estimated_completion"].isoformat() if row["estimated_completion"] else None,
                "metrics": row["metrics"],
            }
    except Exception:
        db.rollback()

    # release queue depth by status
    queue = {}
    for r in _scalar_rows(
        "SELECT status, COUNT(*) releases, COALESCE(SUM(count),0) messages "
        "FROM campaign_releases GROUP BY status",
        lambda r: r,
    ):
        queue[r["status"]] = {"releases": int(r["releases"]), "messages": int(r["messages"])}

    return {
        "configured": last_run is not None,
        "last_run": last_run,
        "queue": queue,
        "pending_messages": queue.get("pending", {}).get("messages", 0),
        "in_flight_messages": queue.get("queued", {}).get("messages", 0),
    }
