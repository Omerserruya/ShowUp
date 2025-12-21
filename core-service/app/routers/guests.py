from __future__ import annotations

import csv
import io
import uuid
import datetime as dt
from typing import Optional, List, Union, Any

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Body
from pydantic import ValidationError
from sqlalchemy.orm import Session
from sqlalchemy import func, case

from app.db import get_db
from app.crud import guest as guest_crud, event as event_crud
from app.schemas.schemas import GuestCreate, GuestOut, GuestUpdate, GuestStatsOut, DailyResponsesOut, DailyResponseData, MilestoneData, PaginatedResponse
from app.utils import paginate_params, validate_phone
from shared.auth.deps import get_current_user_id
from app.models.models import Guest, Campaign


router = APIRouter(prefix="/guests", tags=["guests"])


# Hebrew weekday mapping (0=Monday, 6=Sunday)
WEEKDAY_HEBREW = {
    0: "יום שני",
    1: "יום שלישי",
    2: "יום רביעי",
    3: "יום חמישי",
    4: "יום שישי",
    5: "יום שבת",
    6: "יום ראשון"
}


def _format_hebrew_date(date: dt.date) -> str:
    """Format date to Hebrew weekday name."""
    weekday = WEEKDAY_HEBREW.get(date.weekday(), "יום")
    return weekday


def _normalize_import_counts(payload: dict) -> dict:
    """Ensure legacy guest_count inputs become import_count and guest_count stays unset."""
    if payload.get("import_count") in (None, ""):
        legacy_count = payload.get("guest_count")
        if legacy_count not in (None, ""):
            payload["import_count"] = legacy_count
            payload["guest_count"] = None
    return payload


@router.get("", response_model=Union[list[GuestOut], PaginatedResponse])
def list_guests(
    event_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    search: Optional[str] = Query(None),
    order_by: Optional[str] = Query(None, regex="^(last_response|created_at)$"),
    only_with_responses: bool = Query(False),
    status: Optional[str] = Query(None, regex="^(pending|confirmed|declined|maybe)$"),
    return_total: bool = Query(False, description="Return paginated response with total count"),
):
    event = event_crud.get_event(db, event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found or not permitted")
    page, page_size = paginate_params(page, page_size)
    items, total = guest_crud.list_guests(
        db, 
        event_id=event_id, 
        page=page, 
        page_size=page_size, 
        search=search,
        order_by=order_by,
        only_with_responses=only_with_responses,
        status=status,
    )
    if return_total:
        return PaginatedResponse(total=total, page=page, page_size=page_size, items=items)
    return items


@router.get("/stats", response_model=GuestStatsOut)
def get_guest_stats(
    event_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Get RSVP statistics for an event."""
    event = event_crud.get_event(db, event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found or not permitted")
    
    # Calculate statistics based on counts:
    # - Total: sum of import_count for all guests
    # - Confirmed: sum of guest_count for attending guests, or import_count if guest_count is None
    # - Declined: sum of import_count for declined guests
    # - Pending: count of guests with status 'invited' or 'pending'
    
    from sqlalchemy import func, case, or_
    
    # Total: sum of all import_count
    total_result = db.query(func.sum(Guest.import_count)).filter(
        Guest.event_id == str(event_id)
    ).scalar()
    total = int(total_result) if total_result else 0
    
    # Confirmed: sum of guest_count if exists, otherwise import_count, for attending guests
    confirmed_result = db.query(
        func.sum(
            case(
                (Guest.guest_count.isnot(None), Guest.guest_count),
                else_=Guest.import_count
            )
        )
    ).filter(
        Guest.event_id == str(event_id),
        Guest.status.in_(['attending', 'confirmed'])
    ).scalar()
    confirmed = int(confirmed_result) if confirmed_result else 0
    
    # Declined: sum of import_count for declined guests
    declined_result = db.query(func.sum(Guest.import_count)).filter(
        Guest.event_id == str(event_id),
        Guest.status == 'declined'
    ).scalar()
    declined = int(declined_result) if declined_result else 0
    
    # Pending: count of guests (not sum of counts)
    pending = db.query(Guest).filter(
        Guest.event_id == str(event_id),
        Guest.status.in_(['invited', 'pending'])
    ).count()
    
    return GuestStatsOut(
        total=total,
        confirmed=confirmed,
        declined=declined,
        pending=pending
    )


@router.get("/daily-responses", response_model=DailyResponsesOut)
def get_daily_responses(
    event_id: uuid.UUID = Query(...),
    period: str = Query("week", regex="^(week|month|year)$"),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Get daily response statistics for an event."""
    event = event_crud.get_event(db, event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found or not permitted")
    
    # Calculate date range based on period
    end_date = dt.datetime.now(dt.timezone.utc)
    if period == "week":
        start_date = end_date - dt.timedelta(days=7)
    elif period == "month":
        start_date = end_date - dt.timedelta(days=30)
    else:  # year
        start_date = end_date - dt.timedelta(days=365)
    
    # Query daily responses grouped by date
    # First try to get responses in the requested time range
    daily_query = (
        db.query(
            func.date(Guest.last_response).label('date'),
            func.sum(case((Guest.status.in_(['attending', 'confirmed']), 1), else_=0)).label('confirmed'),
            func.sum(case((Guest.status == 'declined', 1), else_=0)).label('declined')
        )
        .filter(
            Guest.event_id == str(event_id),
            Guest.last_response.isnot(None),
            Guest.last_response >= start_date,
            Guest.last_response <= end_date
        )
        .group_by(func.date(Guest.last_response))
        .order_by(func.date(Guest.last_response))
    )
    
    daily_results = daily_query.all()
    used_fallback = False
    
    # If no results in the time range, get all responses (for demo data that might be older)
    # This handles cases where demo data was created with dates outside the current period
    if not daily_results:
        # Get all responses for this event, sorted by date (most recent first, then take last 30)
        all_responses_query = (
            db.query(
                func.date(Guest.last_response).label('date'),
                func.sum(case((Guest.status.in_(['attending', 'confirmed']), 1), else_=0)).label('confirmed'),
                func.sum(case((Guest.status == 'declined', 1), else_=0)).label('declined')
            )
            .filter(
                Guest.event_id == str(event_id),
                Guest.last_response.isnot(None)
            )
            .group_by(func.date(Guest.last_response))
            .order_by(func.date(Guest.last_response).desc())  # Most recent first
            .limit(30)  # Take last 30 days with responses
        )
        daily_results = all_responses_query.all()
        # Reverse to show chronological order (oldest first)
        daily_results = list(reversed(daily_results))
        used_fallback = True
    
    # If we still have no data at all, return empty structures early
    if not daily_results:
        return DailyResponsesOut(data=[], milestones=[])

    # Build a continuous date range and fill in missing days with zeros
    counts_by_date: dict[dt.date, dict[str, int]] = {}
    min_date: Optional[dt.date] = None
    max_date: Optional[dt.date] = None

    for row in daily_results:
        date_obj = row.date if isinstance(row.date, dt.date) else dt.datetime.strptime(str(row.date), '%Y-%m-%d').date()
        counts_by_date[date_obj] = {
            "confirmed": int(row.confirmed or 0),
            "declined": int(row.declined or 0),
        }
        if min_date is None or date_obj < min_date:
            min_date = date_obj
        if max_date is None or date_obj > max_date:
            max_date = date_obj

    assert min_date is not None and max_date is not None  # for mypy

    # Determine the date range to display.
    # - If we used the requested period, show from start_date..end_date
    # - If we fell back to "last 30 days with responses", synthesize a fixed window
    #   (e.g. 7 ימים או 30 ימים) כדי שתמיד יראו רצף מלא כולל ימים בלי תגובה.
    if used_fallback:
        if period == "week":
            range_start = min_date
            range_end = min_date + dt.timedelta(days=6)
        elif period == "month":
            range_start = min_date
            range_end = min_date + dt.timedelta(days=29)
        else:  # year fallback – השתמש בטווח המלא של הדאטה
            range_start = min_date
            range_end = max_date
    else:
        range_start = start_date.date()
        range_end = end_date.date()

    daily_data: list[DailyResponseData] = []
    current_date = range_start
    while current_date <= range_end:
        counts = counts_by_date.get(current_date, {"confirmed": 0, "declined": 0})
        daily_data.append(DailyResponseData(
            date=current_date.isoformat(),
            dateLabel=_format_hebrew_date(current_date),
            confirmed=counts["confirmed"],
            declined=counts["declined"],
        ))
        current_date += dt.timedelta(days=1)
    
    # Get milestones from campaigns in the same visible date range
    display_start_dt = dt.datetime.combine(range_start, dt.time.min).replace(tzinfo=dt.timezone.utc)
    display_end_dt = dt.datetime.combine(range_end, dt.time.max).replace(tzinfo=dt.timezone.utc)

    milestones_query = (
        db.query(Campaign)
        .filter(
            Campaign.event_id == str(event_id),
            Campaign.schedule_time.isnot(None),
            Campaign.schedule_time >= display_start_dt,
            Campaign.schedule_time <= display_end_dt,
        )
        .order_by(Campaign.schedule_time)
    )
    
    milestones = []
    for campaign in milestones_query.all():
        if campaign.schedule_time:
            # Convert to date
            campaign_date = campaign.schedule_time.date() if hasattr(campaign.schedule_time, 'date') else dt.datetime.fromisoformat(str(campaign.schedule_time)).date()
            milestones.append(MilestoneData(
                date=campaign_date.isoformat(),
                dateLabel=_format_hebrew_date(campaign_date),
                label=campaign.name
            ))
    
    return DailyResponsesOut(
        data=daily_data,
        milestones=milestones
    )


@router.get("/{guest_id}", response_model=GuestOut)
def get_guest(guest_id: uuid.UUID, db: Session = Depends(get_db)):
    guest = guest_crud.get_guest(db, guest_id)
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    return guest


@router.post("", response_model=Union[GuestOut, List[GuestOut]], status_code=201)
def create_guests(
    event_id: uuid.UUID = Query(...),
    payload: Any = Body(...),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    # Normalize incoming payload to a list of dicts
    items_raw: List[dict] = []
    if isinstance(payload, list):
        items_raw = payload
    elif isinstance(payload, dict) and "items" in payload and isinstance(payload["items"], list):
        items_raw = payload["items"]
    elif isinstance(payload, dict):
        items_raw = [payload]
    else:
        raise HTTPException(status_code=400, detail="Body must be an object or array of objects")

    # AuthZ check once per request
    event = event_crud.get_event(db, event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found or not permitted")

    # Build GuestCreate list with validation
    valid_items: List[GuestCreate] = []
    for raw in items_raw:
        raw = dict(raw or {})
        raw["event_id"] = str(event_id)
        phone = str(raw.get("phone", ""))
        if not validate_phone(phone):
            continue
        raw = _normalize_import_counts(raw)
        try:
            item = GuestCreate(**raw)
            valid_items.append(item)
        except ValidationError:
            continue

    if not valid_items:
        return []

    # Decide single vs bulk persistence
    if len(valid_items) == 1:
        return guest_crud.create_guests_bulk(db, event_id=event_id, items=valid_items)
    return guest_crud.create_guests_bulk(db, event_id=event_id, items=valid_items)


@router.post("/bulk", response_model=list[GuestOut])
async def bulk_import(
    event_id: uuid.UUID = Query(...),
    file: UploadFile | None = File(None),
    body: List[GuestCreate] | None = None,
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    event = event_crud.get_event(db, event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found or not permitted")

    guests_to_create: List[GuestCreate] = []
    if file is not None:
        content = await file.read()
        text = content.decode("utf-8")
        reader = csv.DictReader(io.StringIO(text))
        for row in reader:
            name = row.get("name") or row.get("Name")
            phone = row.get("phone") or row.get("Phone")
            email = row.get("email") or row.get("Email")
            group = row.get("group") or row.get("Group")
            table_number_raw = row.get("table_number") or row.get("Table Number") or row.get("tableNumber")
            raw_import_count = (
                row.get("import_count")
                or row.get("Import Count")
                or row.get("importCount")
                or row.get("guest_count")
                or row.get("Guest Count")
                or row.get("guestCount")
            )
            if not name or not phone:
                continue
            if not validate_phone(phone):
                continue
            normalized_payload = _normalize_import_counts(
                {
                    "event_id": event_id,
                    "name": name,
                    "phone": phone,
                    "email": email,
                    "group": group,
                    "import_count": raw_import_count,
                }
            )
            # Safely parse table_number if provided
            if table_number_raw not in (None, ""):
                try:
                    normalized_payload["table_number"] = int(table_number_raw)
                except ValueError:
                    pass
            guests_to_create.append(GuestCreate(**normalized_payload))
    elif body is not None:
        for g in body:
            if validate_phone(g.phone):
                payload = g.model_dump()
                payload = _normalize_import_counts(payload)
                guests_to_create.append(GuestCreate(**payload))
    else:
        raise HTTPException(status_code=400, detail="Provide CSV file or JSON body")

    created = []
    for g in guests_to_create:
        created.append(guest_crud.create_guest(db, g))
    return created


# (removed bulk-json; bulk now supported on POST /guests with array body and event_id in query)


@router.delete("", response_model=dict)
def delete_guests_by_event(
    event_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    event = event_crud.get_event(db, event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found or not permitted")
    count = guest_crud.delete_guests_by_event(db, event_id=event_id)
    return {"deleted": count}


@router.put("/{guest_id}", response_model=GuestOut)
def update_guest(guest_id: uuid.UUID, payload: GuestUpdate, db: Session = Depends(get_db)):
    guest = guest_crud.get_guest(db, guest_id)
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    if payload.phone is not None and not validate_phone(payload.phone):
        raise HTTPException(status_code=422, detail="Invalid phone format")
    guest = guest_crud.update_guest(db, guest, payload)
    return guest


@router.delete("/{guest_id}", status_code=204)
def delete_guest(guest_id: uuid.UUID, db: Session = Depends(get_db)):
    guest = guest_crud.get_guest(db, guest_id)
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    guest_crud.delete_guest(db, guest)
    return None


