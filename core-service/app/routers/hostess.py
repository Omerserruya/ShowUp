"""Entrance hostess mode: who arrived, how many, where they sit.

Owner side (JWT, event RBAC) - create / rotate / revoke the hostess link:
- GET    /events/{event_id}/hostess
- POST   /events/{event_id}/hostess          (?rotate=true issues a new token)
- DELETE /events/{event_id}/hostess

Hostess side (UNAUTHENTICATED, whitelisted via the `/public/` prefix):
- GET    /public/hostess/{token}             guest list + tables + arrivals
- POST   /public/hostess/{token}/checkins    {guest_id, count, table_number?}
- DELETE /public/hostess/{token}/checkins/{guest_id}
- POST   /public/hostess/{token}/walkins     {name, count, table_number?, group?, note?}
- PATCH  /public/hostess/{token}/walkins/{id}
- DELETE /public/hostess/{token}/walkins/{id}

AUTHORISATION MODEL: venue staff at the door have no ShowUp account, so the
link itself is the credential (like the public invite). The token is 32 random
bytes, revocable and rotatable by the owner, and dies two days after the event.
The hostess sees names, groups, tables and party sizes - never full phone
numbers (last 4 digits only, to tell two "דנה כהן" apart).
"""
from __future__ import annotations

import datetime as dt
import secrets
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.authz import require_event_permission
from app.crud import event as event_crud
from app.db import get_db
from app.models.models import Event, Guest
from shared.auth.deps import get_current_user_id
from shared.domain.hostess import MAX_PARTY, expected_count, table_load, tables_from_layout
from shared.domain.roles import Action

router = APIRouter(tags=["hostess"])
public_router = APIRouter(prefix="/public/hostess", tags=["hostess"])

LINK_GRACE = dt.timedelta(days=2)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _link(db: Session, event_id) -> Optional[dict]:
    row = db.execute(text("SELECT token, created_at FROM hostess_links WHERE event_id = :e"),
                     {"e": str(event_id)}).mappings().first()
    return dict(row) if row else None


def _link_out(event: Event, link: Optional[dict]) -> dict:
    if not link:
        return {"enabled": False, "token": None, "path": None, "expires_at": None}
    expires = (event.event_date + LINK_GRACE) if event.event_date else None
    return {"enabled": True, "token": link["token"], "path": f"/hostess/{link['token']}",
            "created_at": link["created_at"], "expires_at": expires}


def _owner_event(db: Session, event_id: uuid.UUID, user_id: uuid.UUID, action: Action) -> Event:
    event = event_crud.get_event(db, event_id)
    require_event_permission(db, event, user_id, action)
    return event


@router.get("/events/{event_id}/hostess")
def get_hostess_link(event_id: uuid.UUID, db: Session = Depends(get_db),
                     user_id: uuid.UUID = Depends(get_current_user_id)):
    event = _owner_event(db, event_id, user_id, Action.GUEST_READ)
    return _link_out(event, _link(db, event_id))


@router.post("/events/{event_id}/hostess")
def create_hostess_link(event_id: uuid.UUID, rotate: bool = Query(False), db: Session = Depends(get_db),
                        user_id: uuid.UUID = Depends(get_current_user_id)):
    event = _owner_event(db, event_id, user_id, Action.EVENT_WRITE)
    link = _link(db, event_id)
    if link and not rotate:
        return _link_out(event, link)
    db.execute(text(
        "INSERT INTO hostess_links (event_id, token, created_by) VALUES (:e, :t, :u) "
        "ON CONFLICT (event_id) DO UPDATE SET token = EXCLUDED.token, created_by = EXCLUDED.created_by, "
        "created_at = now()"), {"e": str(event_id), "t": secrets.token_urlsafe(32), "u": str(user_id)})
    db.commit()
    return _link_out(event, _link(db, event_id))


@router.delete("/events/{event_id}/hostess", status_code=204)
def revoke_hostess_link(event_id: uuid.UUID, db: Session = Depends(get_db),
                        user_id: uuid.UUID = Depends(get_current_user_id)):
    _owner_event(db, event_id, user_id, Action.EVENT_WRITE)
    db.execute(text("DELETE FROM hostess_links WHERE event_id = :e"), {"e": str(event_id)})
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------- hostess side

def _event_for_token(db: Session, token: str) -> Event:
    row = db.execute(text("SELECT event_id FROM hostess_links WHERE token = :t"),
                     {"t": token or ""}).first() if len(token or "") >= 20 else None
    event = event_crud.get_event(db, row[0]) if row else None
    if not event:
        raise HTTPException(status_code=404, detail="hostess_link_not_found")
    if event.event_date and _now() > event.event_date + LINK_GRACE:
        raise HTTPException(status_code=410, detail="hostess_link_expired")
    return event


def _guest_in_event(db: Session, event: Event, guest_id: uuid.UUID) -> Guest:
    guest = db.query(Guest).filter(Guest.id == guest_id, Guest.event_id == event.id).first()
    if not guest:
        raise HTTPException(status_code=404, detail="guest_not_found")
    return guest


def _phone_tail(phone: Optional[str]) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    return digits[-4:] if len(digits) >= 4 else ""


@public_router.get("/{token}")
def hostess_view(token: str, db: Session = Depends(get_db)):
    event = _event_for_token(db, token)
    checkins = db.execute(text(
        "SELECT id, guest_id, name, guest_group, note, arrived_count, table_number, arrived_at "
        "FROM guest_checkins WHERE event_id = :e ORDER BY arrived_at"), {"e": str(event.id)}).mappings().all()
    by_guest = {str(c["guest_id"]): c for c in checkins if c["guest_id"]}

    guests = []
    for g in db.query(Guest).filter(Guest.event_id == event.id).order_by(Guest.name).all():
        c = by_guest.get(str(g.id))
        guests.append({
            "id": str(g.id), "name": g.name, "group": g.group or "", "table": g.table_number,
            "status": g.status, "expected": expected_count(g.status, g.guest_count, g.import_count),
            "phone_tail": _phone_tail(g.phone),
            "arrived": c["arrived_count"] if c else 0,
            "seated_table": c["table_number"] if c else None,
            "arrived_at": c["arrived_at"] if c else None,
        })
    walkins = [{
        "id": str(c["id"]), "name": c["name"], "group": c["guest_group"] or "", "note": c["note"] or "",
        "count": c["arrived_count"], "table": c["table_number"], "arrived_at": c["arrived_at"],
    } for c in checkins if not c["guest_id"]]

    tables = table_load(tables_from_layout(event.seating_layout), guests, walkins)
    confirmed = [g for g in guests if g["status"] in ("attending", "confirmed")]
    stats = {
        "expected_people": sum(g["expected"] for g in confirmed),
        "arrived_people": sum(g["arrived"] for g in guests) + sum(w["count"] for w in walkins),
        "arrived_parties": sum(1 for g in guests if g["arrived"]) + len(walkins),
        "walkin_people": sum(w["count"] for w in walkins),
    }
    return {
        "event": {"name": event.name, "event_date": event.event_date, "location": event.location},
        "tables": tables, "guests": guests, "walkins": walkins, "stats": stats, "server_time": _now(),
    }


class CheckinIn(BaseModel):
    guest_id: uuid.UUID
    count: int = Field(..., ge=1, le=MAX_PARTY)
    table_number: Optional[int] = Field(None, ge=0, le=10_000)


@public_router.post("/{token}/checkins")
def check_in(token: str, body: CheckinIn, db: Session = Depends(get_db)):
    """Mark a listed party as arrived (or correct its count/table). Idempotent
    per guest - two tablets checking in the same party end up with one row."""
    event = _event_for_token(db, token)
    guest = _guest_in_event(db, event, body.guest_id)
    table = body.table_number if body.table_number is not None else guest.table_number
    db.execute(text(
        "INSERT INTO guest_checkins (id, event_id, guest_id, arrived_count, table_number) "
        "VALUES (:id, :e, :g, :n, :t) "
        "ON CONFLICT (guest_id) WHERE guest_id IS NOT NULL DO UPDATE SET "
        "arrived_count = EXCLUDED.arrived_count, table_number = EXCLUDED.table_number, updated_at = now()"),
        {"id": str(uuid.uuid4()), "e": str(event.id), "g": str(guest.id), "n": body.count, "t": table})
    db.commit()
    return {"ok": True, "guest_id": str(guest.id), "arrived": body.count, "seated_table": table}


@public_router.delete("/{token}/checkins/{guest_id}", status_code=204)
def undo_check_in(token: str, guest_id: uuid.UUID, db: Session = Depends(get_db)):
    event = _event_for_token(db, token)
    db.execute(text("DELETE FROM guest_checkins WHERE event_id = :e AND guest_id = :g"),
               {"e": str(event.id), "g": str(guest_id)})
    db.commit()
    return Response(status_code=204)


class WalkinIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    count: int = Field(1, ge=1, le=MAX_PARTY)
    table_number: Optional[int] = Field(None, ge=0, le=10_000)
    group: Optional[str] = Field(None, max_length=100)
    note: Optional[str] = Field(None, max_length=500)


class WalkinPatch(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    count: Optional[int] = Field(None, ge=1, le=MAX_PARTY)
    table_number: Optional[int] = Field(None, ge=0, le=10_000)
    clear_table: bool = False


@public_router.post("/{token}/walkins", status_code=201)
def add_walkin(token: str, body: WalkinIn, db: Session = Depends(get_db)):
    """A guest who is not on the list. Recorded as a check-in only - never added
    to `guests`, so a walk-in is never messaged by a later round."""
    event = _event_for_token(db, token)
    wid = str(uuid.uuid4())
    db.execute(text(
        "INSERT INTO guest_checkins (id, event_id, name, guest_group, note, arrived_count, table_number) "
        "VALUES (:id, :e, :name, :grp, :note, :n, :t)"),
        {"id": wid, "e": str(event.id), "name": body.name.strip(), "grp": (body.group or "").strip() or None,
         "note": (body.note or "").strip() or None, "n": body.count, "t": body.table_number})
    db.commit()
    return {"id": wid}


@public_router.patch("/{token}/walkins/{walkin_id}")
def edit_walkin(token: str, walkin_id: uuid.UUID, body: WalkinPatch, db: Session = Depends(get_db)):
    event = _event_for_token(db, token)
    sets, params = [], {"id": str(walkin_id), "e": str(event.id)}
    if body.name is not None:
        sets.append("name = :name"); params["name"] = body.name.strip()
    if body.count is not None:
        sets.append("arrived_count = :n"); params["n"] = body.count
    if body.clear_table:
        sets.append("table_number = NULL")
    elif body.table_number is not None:
        sets.append("table_number = :t"); params["t"] = body.table_number
    if not sets:
        raise HTTPException(status_code=422, detail="nothing_to_update")
    res = db.execute(text(f"UPDATE guest_checkins SET {', '.join(sets)}, updated_at = now() "
                          "WHERE id = :id AND event_id = :e AND guest_id IS NULL"), params)
    db.commit()
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="walkin_not_found")
    return {"ok": True}


@public_router.delete("/{token}/walkins/{walkin_id}", status_code=204)
def delete_walkin(token: str, walkin_id: uuid.UUID, db: Session = Depends(get_db)):
    event = _event_for_token(db, token)
    db.execute(text("DELETE FROM guest_checkins WHERE id = :id AND event_id = :e AND guest_id IS NULL"),
               {"id": str(walkin_id), "e": str(event.id)})
    db.commit()
    return Response(status_code=204)
