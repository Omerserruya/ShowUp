"""
Admin API endpoints – event management (core-service).
All endpoints require admin role.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.models import Event, Guest, Campaign
from shared.auth.admin import get_admin_user_id

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
