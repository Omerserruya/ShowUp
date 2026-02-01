from __future__ import annotations

import csv
import io
import uuid
import datetime as dt
from typing import Optional, List, Union, Any
from enum import Enum

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Body
from fastapi.responses import StreamingResponse, Response
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


class ExportFormat(str, Enum):
    csv = "csv"
    xlsx = "xlsx"


def normalize_phone_for_import(phone: str) -> str:
    """
    Normalize phone number for import.
    If it's an Israeli number (starts with 0, or 9 digits, or starts with 972),
    automatically add +972 prefix.
    Otherwise, keep as is (assuming it's already international format).
    """
    import re
    phone_str = str(phone).strip()
    
    # Remove all non-digit characters except +
    cleaned = re.sub(r"[^\d+]", "", phone_str)
    
    # If already starts with +, check if it's valid international format
    if cleaned.startswith("+"):
        # Already international format, validate and return
        digits_only = cleaned[1:]
        if len(digits_only) >= 7 and len(digits_only) <= 15:
            return cleaned
        # If invalid, try to fix as Israeli
        if digits_only.startswith("972"):
            return f"+{digits_only}"
        # Try to treat as Israeli without country code
        if len(digits_only) == 9 or (len(digits_only) == 10 and digits_only.startswith("0")):
            if digits_only.startswith("0"):
                digits_only = digits_only[1:]
            return f"+972{digits_only}"
    
    # No + prefix - check if it's Israeli number
    digits_only = cleaned
    
    # Israeli number patterns:
    # - 10 digits starting with 0 (e.g., 0501234567)
    # - 9 digits (e.g., 501234567)
    # - 12 digits starting with 972 (e.g., 972501234567)
    
    if len(digits_only) == 10 and digits_only.startswith("0"):
        # Remove leading 0 and add +972
        return f"+972{digits_only[1:]}"
    elif len(digits_only) == 9:
        # 9 digits - assume Israeli mobile number
        return f"+972{digits_only}"
    elif len(digits_only) == 12 and digits_only.startswith("972"):
        # Already has 972 prefix, just add +
        return f"+{digits_only}"
    elif len(digits_only) >= 7 and len(digits_only) <= 15:
        # Looks like international number without +, return as is
        # (validation will catch if invalid)
        return f"+{digits_only}"
    else:
        # Default: assume Israeli if unclear
        if digits_only.startswith("0"):
            digits_only = digits_only[1:]
        if len(digits_only) == 9:
            return f"+972{digits_only}"
        # Return as is, validation will catch if invalid
        return f"+{digits_only}" if not digits_only.startswith("+") else digits_only


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
    page_size: int = Query(20, ge=1, le=2000),
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
        # Convert Guest models to GuestOut schemas explicitly
        from app.schemas.schemas import GuestOut
        guest_outs = [GuestOut.model_validate(item) for item in items]
        return PaginatedResponse(total=total, page=page, page_size=page_size, items=guest_outs)
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
    
    # Total guests: count of guest records (number of invitations)
    total_guests = db.query(Guest).filter(
        Guest.event_id == str(event_id)
    ).count()
    
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
        total_guests=total_guests,
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


@router.get("/import-template")
def download_import_template(
    export_format: ExportFormat = Query(ExportFormat.xlsx),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """
    Download a blank import template (CSV or XLSX) with the required headers only.
    No event_id required - this is just a template file.
    """
    headers = ["שם מלא", "טלפון", "אימייל", "קבוצה", "כמות מוזמנים", "מספר שולחן"]

    if export_format == ExportFormat.csv:
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(headers)
        csv_text = output.getvalue()
        csv_bytes = ("\ufeff" + csv_text).encode("utf-8-sig")
        return Response(
            content=csv_bytes,
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="guest_import_template.csv"'},
        )

    try:
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font, PatternFill
    except ImportError:
        raise HTTPException(status_code=500, detail="openpyxl is not installed on server")

    wb = Workbook()
    ws = wb.active
    ws.title = "תבנית ייבוא"
    ws.sheet_view.rightToLeft = True

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="1E3A8A")
    header_alignment = Alignment(horizontal="center", vertical="center")

    ws.append(headers)
    for cell in ws[1]:
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)

    return Response(
        content=output.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="guest_import_template.xlsx"'},
    )


@router.get("/export")
def export_guests(
    event_id: uuid.UUID = Query(...),
    export_format: str = Query("csv"),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """
    Export guests for an event as CSV or XLSX.

    - CSV: UTF-8 with BOM, so Hebrew displays correctly in Excel.
    - XLSX: basic styled sheet, RTL, with Hebrew headers.
    """
    # Validate export_format
    if export_format not in ("csv", "xlsx"):
        raise HTTPException(status_code=422, detail=f"Invalid export_format: {export_format}. Must be 'csv' or 'xlsx'")
    
    event = event_crud.get_event(db, event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found or not permitted")

    # Fetch all guests for this event (no pagination)
    guests, _total = guest_crud.list_guests(
        db=db,
        event_id=event_id,
        page=1,
        page_size=10_000,  # safe upper bound
        search=None,
        order_by="created_at",
        only_with_responses=False,
        status=None,
    )

    # Define columns we want to export
    headers = [
        "שם מלא",
        "טלפון",
        "אימייל",
        "קבוצה",
        "סטטוס",
        "כמות מוזמנים (Import)",
        "כמות שאישרו (Guest Count)",
        "מספר שולחן",
        "תאריך יצירה",
        "עדכון אחרון",
    ]

    # Helper to map status to Hebrew label
    status_hebrew = {
        "invited": "מוזמן",
        "pending": "ממתין",
        "attending": "מאשר הגעה",
        "confirmed": "מאשר הגעה",
        "declined": "לא מגיע",
        "maybe": "אולי",
    }

    if export_format == "csv":
        # Build CSV in memory with UTF-8 BOM so Excel handles Hebrew properly
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(headers)

        for g in guests:
            writer.writerow([
                g.name,
                g.phone,
                g.email or "",
                g.group or "",
                status_hebrew.get(g.status, g.status or ""),
                g.import_count,
                g.guest_count or "",
                g.table_number or "",
                g.created_at.isoformat() if getattr(g, "created_at", None) else "",
                g.last_response.isoformat() if g.last_response else "",
            ])

        csv_text = output.getvalue()
        # Prefix BOM so Excel recognizes UTF-8 Hebrew properly
        csv_bytes = ("\ufeff" + csv_text).encode("utf-8-sig")

        return Response(
            content=csv_bytes,
            media_type="text/csv; charset=utf-8",
            headers={
                "Content-Disposition": 'attachment; filename="guests.csv"',
            },
        )

    # XLSX export
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font, PatternFill
    except ImportError:
        raise HTTPException(status_code=500, detail="openpyxl is not installed on server")

    wb = Workbook()
    ws = wb.active
    ws.title = "אורחים"
    # Right-to-left for Hebrew
    ws.sheet_view.rightToLeft = True

    # Header row styling
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="1E3A8A")  # deep blue
    header_alignment = Alignment(horizontal="center", vertical="center")

    ws.append(headers)
    for cell in ws[1]:
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment

    # Data rows
    for g in guests:
        ws.append([
            g.name,
            g.phone,
            g.email or "",
            g.group or "",
            status_hebrew.get(g.status, g.status or ""),
            g.import_count,
            g.guest_count or "",
            g.table_number or "",
            g.created_at.isoformat() if getattr(g, "created_at", None) else "",
            g.last_response.isoformat() if g.last_response else "",
        ])

    # Auto width (roughly)
    for col in ws.columns:
        max_length = 0
        col_letter = col[0].column_letter  # type: ignore[attr-defined]
        for cell in col:
            try:
                cell_len = len(str(cell.value)) if cell.value is not None else 0
                if cell_len > max_length:
                    max_length = cell_len
            except Exception:
                continue
        ws.column_dimensions[col_letter].width = max(10, min(max_length + 2, 40))

    # Align text right for Hebrew text columns
    rtl_alignment = Alignment(horizontal="right", vertical="center")
    for row in ws.iter_rows(min_row=2, max_row=ws.max_row, min_col=1, max_col=8):
        for cell in row:
            cell.alignment = rtl_alignment

    # Serialize workbook to bytes
    output_stream = io.BytesIO()
    wb.save(output_stream)
    output_stream.seek(0)

    return StreamingResponse(
        output_stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": 'attachment; filename="guests.xlsx"',
        },
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
    try:
        if len(valid_items) == 1:
            return guest_crud.create_guests_bulk(db, event_id=event_id, items=valid_items)
        return guest_crud.create_guests_bulk(db, event_id=event_id, items=valid_items)
    except ValueError as e:
        # Handle capacity limit errors
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/bulk", response_model=list[GuestOut])
async def bulk_import(
    event_id: uuid.UUID = Query(...),
    file: UploadFile | None = File(None),
    body: List[GuestCreate] | None = None,
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """
    Bulk import guests from CSV or XLSX file, or from JSON body.

    - If `file` is provided:
        * Supports UTF-8 CSV
        * Supports XLSX/XLS (first sheet, first row as headers)
    - If `body` is provided:
        * Expects a list[GuestCreate]
    """
    event = event_crud.get_event(db, event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found or not permitted")

    guests_to_create: List[GuestCreate] = []

    # Helper to build GuestCreate from a generic row dict
    def build_guest_from_row(row: dict) -> GuestCreate | None:
        # Normalize possible header names (English / Hebrew / variations)
        name = (
            row.get("name")
            or row.get("Name")
            or row.get("שם מלא")
            or row.get("שם")
        )
        phone = (
            row.get("phone")
            or row.get("Phone")
            or row.get("טלפון")
        )
        email = row.get("email") or row.get("Email") or row.get("אימייל")
        group = row.get("group") or row.get("Group") or row.get("קבוצה")

        table_number_raw = (
            row.get("table_number")
            or row.get("Table Number")
            or row.get("tableNumber")
            or row.get("מספר שולחן")
        )
        raw_import_count = (
            row.get("import_count")
            or row.get("Import Count")
            or row.get("importCount")
            or row.get("guest_count")
            or row.get("Guest Count")
            or row.get("guestCount")
            or row.get("כמות מוזמנים (Import)")
        )

        if not name or not phone:
            return None
        
        # Normalize phone number (add +972 for Israeli numbers if needed)
        phone_normalized = normalize_phone_for_import(str(phone))
        
        if not validate_phone(phone_normalized):
            return None

        normalized_payload = _normalize_import_counts(
            {
                "event_id": event_id,
                "name": name,
                "phone": phone_normalized,
                "email": email,
                "group": group,
                "import_count": raw_import_count,
            }
        )
        # Safely parse table_number if provided
        if table_number_raw not in (None, ""):
            try:
                normalized_payload["table_number"] = int(table_number_raw)
            except (ValueError, TypeError):
                pass

        return GuestCreate(**normalized_payload)

    if file is not None:
        content = await file.read()
        filename = (file.filename or "").lower()

        # XLSX / XLS import
        if filename.endswith((".xlsx", ".xls")):
            try:
                from openpyxl import load_workbook
            except ImportError:
                raise HTTPException(status_code=500, detail="openpyxl is not installed on server")

            wb = load_workbook(io.BytesIO(content), data_only=True)
            ws = wb.active

            # Assume first row is header
            rows_iter = ws.iter_rows(values_only=True)
            try:
                header_row = next(rows_iter)
            except StopIteration:
                header_row = None

            if not header_row:
                raise HTTPException(status_code=400, detail="Empty Excel file")

            headers = [str(h).strip() if h is not None else "" for h in header_row]

            for data_row in rows_iter:
                row_dict = {}
                for idx, value in enumerate(data_row):
                    if idx < len(headers):
                        key = headers[idx]
                        if key:
                            row_dict[key] = value
                guest = build_guest_from_row(row_dict)
                if guest is not None:
                    guests_to_create.append(guest)

        # CSV import (default)
        else:
            text = content.decode("utf-8-sig")  # handle BOM if present
            reader = csv.DictReader(io.StringIO(text))
            for row in reader:
                guest = build_guest_from_row(row)
                if guest is not None:
                    guests_to_create.append(guest)

    elif body is not None:
        for g in body:
            if validate_phone(g.phone):
                payload = g.model_dump()
                payload = _normalize_import_counts(payload)
                guests_to_create.append(GuestCreate(**payload))
    else:
        raise HTTPException(status_code=400, detail="Provide CSV/XLSX file or JSON body")

    created = []
    for g in guests_to_create:
        try:
            created.append(guest_crud.create_guest(db, g))
        except ValueError as e:
            # Handle capacity limit or other validation errors
            raise HTTPException(status_code=400, detail=str(e))
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


