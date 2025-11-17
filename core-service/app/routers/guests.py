from __future__ import annotations

import csv
import io
import uuid
from typing import Optional, List, Union, Any

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Body
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.db import get_db
from app.crud import guest as guest_crud, event as event_crud
from app.schemas.schemas import GuestCreate, GuestOut, GuestUpdate
from app.utils import paginate_params, validate_phone
from shared.auth.deps import get_current_user_id


router = APIRouter(prefix="/guests", tags=["guests"])


def _normalize_import_counts(payload: dict) -> dict:
    """Ensure legacy guest_count inputs become import_count and guest_count stays unset."""
    if payload.get("import_count") in (None, ""):
        legacy_count = payload.get("guest_count")
        if legacy_count not in (None, ""):
            payload["import_count"] = legacy_count
            payload["guest_count"] = None
    return payload


@router.get("", response_model=list[GuestOut])
def list_guests(
    event_id: uuid.UUID = Query(...),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    search: Optional[str] = Query(None),
):
    event = event_crud.get_event(db, event_id)
    if not event or not event_crud.is_owner(event, user_id):
        raise HTTPException(status_code=404, detail="Event not found or not permitted")
    page, page_size = paginate_params(page, page_size)
    items, _ = guest_crud.list_guests(db, event_id=event_id, page=page, page_size=page_size, search=search)
    return items


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
                    "import_count": raw_import_count,
                }
            )
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


