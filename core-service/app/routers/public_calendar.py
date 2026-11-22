"""Public "add to calendar" (UNAUTHENTICATED, whitelisted via the `/public/` prefix).

- GET /public/calendar/{code}      event title / time / place for the /c/{code} page
- GET /public/calendar/{code}.ics  the same as an iCalendar file (Apple, Outlook, Android)

{code} is events.share_code: random, only handed out in the hosts' own messages
(the save-the-date "הוספה ליומן" button). Nothing about guests is exposed.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.models import Event
from shared.domain.messaging.resolver import VariableResolver, parse_location

router = APIRouter(prefix="/public/calendar", tags=["public-calendar"])

DURATION = dt.timedelta(hours=4)     # a guest's calendar block; the event has no end time


def _event(db: Session, code: str) -> Event:
    if not code or len(code) > 16:
        raise HTTPException(404, "not_found")
    ev = db.query(Event).filter(Event.share_code == code).first()
    if ev is None or ev.event_date is None:
        raise HTTPException(404, "not_found")
    return ev


def _details(ev: Event) -> dict:
    vals = VariableResolver({"subjects": ev.subjects, "inviters": ev.inviters or [], "event_type": ev.event_type,
                             "name": ev.name}).values_for({})
    venue, address = parse_location(ev.location)
    start = ev.event_date if ev.event_date.tzinfo else ev.event_date.replace(tzinfo=dt.timezone.utc)
    return {"title": (ev.name or "").strip() or "אירוע", "hosts": (vals.get("host_display_name") or "").strip(),
            "start": start.astimezone(dt.timezone.utc), "venue": venue or "", "address": address or ""}


@router.get("/{code}.ics")
def ics(code: str, db: Session = Depends(get_db)):
    d = _details(_event(db, code))
    fmt = "%Y%m%dT%H%M%SZ"
    esc = lambda s: s.replace("\\", "\\\\").replace(";", "\;").replace(",", "\\,").replace("\n", "\\n")
    where = ", ".join(x for x in (d["venue"], d["address"]) if x)
    body = "\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ShowUp//RSVP//HE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        "BEGIN:VEVENT", f"UID:{code}@showup-rsvp.com",
        f"DTSTAMP:{dt.datetime.now(dt.timezone.utc).strftime(fmt)}",
        f"DTSTART:{d['start'].strftime(fmt)}", f"DTEND:{(d['start'] + DURATION).strftime(fmt)}",
        f"SUMMARY:{esc(d['title'])}", f"LOCATION:{esc(where)}",
        f"DESCRIPTION:{esc(('מארחים: ' + d['hosts']) if d['hosts'] else '')}",
        "END:VEVENT", "END:VCALENDAR", ""])
    return Response(body, media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="event.ics"'})


@router.get("/{code}")
def details(code: str, db: Session = Depends(get_db)):
    d = _details(_event(db, code))
    return {**d, "start": d["start"].isoformat(), "end": (d["start"] + DURATION).isoformat()}
