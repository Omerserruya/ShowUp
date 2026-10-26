"""Public web invitation + open-form RSVP (Phase 16).

UNAUTHENTICATED endpoints (whitelisted in AuthMiddleware via the `/public/`
prefix) that power the shareable web invitation:

- GET  /public/invite/{slug}        -> safe, public view of the invitation design
                                       + event details (NO guest list, owners, or
                                       plan internals).
- POST /public/invite/{slug}/rsvp/lookup -> the requesting guest's OWN RSVP,
                                       authorised by a signed per-guest token.
- POST /public/invite/{slug}/rsvp   -> RSVP submission. With a token it updates
                                       that guest; without one it may only create
                                       a new guest (walk-ins, forwarded invites).

All require the event's invitation to be *published* (the web invitation is
included in every plan).

AUTHORISATION MODEL: possession of the invite link is the credential, like a
password-reset link. The link carries `?g=<token>`, an HMAC over
(event_id, guest_id) - see `shared/domain/invite_token.py`. A phone number is
NOT a credential: it is public knowledge, and treating it as one made this
endpoint both an enumeration oracle over the invitee list and a way to overwrite
any guest's RSVP. Rate limiting is enforced at the edge (nginx `limit_req` on
/api/public) as defence in depth against brute force and mass-RSVP abuse.
"""
from __future__ import annotations

import datetime as dt
import uuid

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.crud import event as event_crud, guest as guest_crud
from app.schemas.schemas import GuestCreate, PublicRsvpIn
from app.utils import normalize_phone
from app.models.models import EventFieldDef, Guest, GuestCustomValue
from shared.domain.enums import GuestStatus
from shared.domain.invite_token import verify_guest_token

router = APIRouter(prefix="/public/invite", tags=["public-invite"])


class RsvpLookupIn(BaseModel):
    """Lookup credential.

    `token` is the per-guest signed token from the invite link. `phone` is
    accepted for backwards compatibility with already-delivered links but is NO
    LONGER a credential on its own - see `lookup_public_rsvp`.
    """
    token: Optional[str] = Field(None, max_length=256)
    phone: Optional[str] = Field(None, min_length=4, max_length=32)


class PublicRsvpWithAnswersIn(PublicRsvpIn):
    """PublicRsvpIn + answers to the host's questions ("שאלות לאורחים").

    `answers` maps question (field) id -> chosen option label. Stored only for
    confirming guests; unknown ids / stale options are ignored so a cached page
    can never block an RSVP.
    """
    answers: Optional[Dict[str, str]] = None


def _public_questions(db: Session, event_id) -> List[EventFieldDef]:
    try:
        return (
            db.query(EventFieldDef)
            .filter(EventFieldDef.event_id == event_id, EventFieldDef.ask_in_rsvp.is_(True),
                    EventFieldDef.data_type == "enum")
            .order_by(EventFieldDef.sort_order, EventFieldDef.created_at)
            .all()
        )
    except Exception:  # column not migrated yet -> no questions, never break the page
        db.rollback()
        return []


def _guest_answers(db: Session, guest_id, questions: List[EventFieldDef]) -> Dict[str, str]:
    ids = [q.id for q in questions]
    if not ids:
        return {}
    rows = (
        db.query(GuestCustomValue)
        .filter(GuestCustomValue.guest_id == _as_uuid(guest_id), GuestCustomValue.field_def_id.in_(ids))
        .all()
    )
    return {str(r.field_def_id): r.value for r in rows if isinstance(r.value, str)}


def _as_uuid(value):
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


def _store_answers(db: Session, event_id, guest_id, answers: Optional[Dict[str, str]]) -> None:
    """Best-effort: the RSVP is already committed; a failure here never fails it."""
    if not answers:
        return
    try:
        _store_answers_unsafe(db, event_id, guest_id, answers)
    except Exception:
        db.rollback()
        import logging
        logging.getLogger(__name__).exception("storing public RSVP answers failed")


def _store_answers_unsafe(db: Session, event_id, guest_id, answers: Dict[str, str]) -> None:
    questions = {str(q.id): q for q in _public_questions(db, event_id)}
    gid = _as_uuid(guest_id)
    for fid, value in answers.items():
        q = questions.get(str(fid))
        if q is None or value not in (q.options or []):
            continue
        row = (
            db.query(GuestCustomValue)
            .filter(GuestCustomValue.guest_id == gid, GuestCustomValue.field_def_id == q.id)
            .first()
        )
        if row:
            row.value = value
        else:
            db.add(GuestCustomValue(guest_id=gid, field_def_id=q.id, value=value))
    db.commit()


def _conflict(exc: ValueError) -> HTTPException:
    """409 with a machine-readable reason, so the page can tell a guest who is
    already on the list apart from an event that is genuinely full."""
    msg = str(exc)
    code = "duplicate_phone" if "already exists" in msg else "capacity"
    return HTTPException(status_code=409, detail={"code": code, "message": msg})


def _require_published_event(db: Session, slug: str):
    event = event_crud.get_event_by_slug(db, slug)
    # 404 (not 403) for unpublished/missing so we never leak which slugs exist.
    if event is None or not getattr(event, "invitation_published", False):
        raise HTTPException(status_code=404, detail="Invitation not found")
    return event


def _public_event_view(event) -> dict:
    """Whitelist of fields safe to expose on the public page - no PII/guest data."""
    return {
        "slug": event.public_slug,
        "name": event.name,
        "event_date": event.event_date.isoformat() if event.event_date else None,
        "location": event.location,
        "inviters": event.inviters or [],
        "invitation": event.invitation or {},
    }


@router.get("/{slug}")
def get_public_invitation(slug: str, db: Session = Depends(get_db)):
    event = _require_published_event(db, slug)
    view = _public_event_view(event)
    view["questions"] = [
        {"id": str(q.id), "label": q.label, "options": list(q.options or [])}
        for q in _public_questions(db, event.id)
    ]
    return view


@router.post("/{slug}/rsvp/lookup")
def lookup_public_rsvp(slug: str, payload: RsvpLookupIn, db: Session = Depends(get_db)):
    """Return the requesting guest's OWN existing RSVP so the page can pre-fill.

    Requires the signed per-guest token from the invite link. A phone number is
    NOT a credential: it is public knowledge, so accepting one here let anybody
    read a named guest's RSVP status and private notes, and enumerate an entire
    invitee list by iterating the Israeli mobile range. A missing or invalid
    token returns `found: false` - identical to a genuinely unknown guest - so
    the endpoint cannot be used to test whether a phone or token exists.
    """
    event = _require_published_event(db, slug)
    guest_id = verify_guest_token(payload.token, event.id)
    if not guest_id:
        return {"found": False}
    g = (
        db.query(Guest)
        .filter(Guest.event_id == str(event.id), Guest.id == guest_id)
        .first()
    )
    if not g:
        return {"found": False}
    # Canonical status: the WhatsApp flow writes the legacy 'attending', which the
    # page used to read as "maybe" - and a re-submit then overwrote a confirmed
    # guest with maybe. Party size: the WhatsApp flow records it in guest_count,
    # the web form / import in import_count.
    return {
        "found": True,
        "name": g.name,
        "status": GuestStatus.normalize(g.status).value,
        "party_size": g.guest_count or g.import_count or None,
        "notes": g.notes,
        "answers": _guest_answers(db, g.id, _public_questions(db, event.id)),
    }


@router.post("/{slug}/rsvp", status_code=201)
def submit_public_rsvp(slug: str, payload: PublicRsvpWithAnswersIn, db: Session = Depends(get_db)):
    event = _require_published_event(db, slug)

    # Respect the per-invitation RSVP toggle.
    config = event.invitation or {}
    if config.get("rsvpEnabled") is False:
        raise HTTPException(status_code=403, detail="RSVP is closed for this event")

    status = GuestStatus.normalize(payload.status).value
    phone_norm = normalize_phone(payload.phone)
    now = dt.datetime.now(dt.timezone.utc)
    party = payload.party_size

    # Atomic critical section: serialize every capacity-affecting write for this
    # event. This makes the check-then-write race-free - two guests confirming at
    # once can't both exceed the limit, and a double-submit from the same phone
    # updates one row instead of creating a duplicate.
    guest_crud.lock_event_capacity(db, event.id)

    # Who is this submission allowed to modify?
    #
    # WITH a valid token: exactly the guest it was issued for. The token - not
    # the submitted phone - decides, so a tokened guest cannot overwrite someone
    # else by typing their number.
    #
    # WITHOUT a token: nobody. An untokened visitor may only CREATE. Matching on
    # phone alone previously let anyone who knew a number overwrite that guest's
    # RSVP (flip a confirmation to declined; the owner saw a legitimate decline
    # and the guest was never told). If the phone already exists we return the
    # same 409 as any duplicate rather than silently updating it.
    token_guest_id = verify_guest_token(payload.token, event.id)
    existing = None
    if token_guest_id:
        existing = (
            db.query(Guest)
            .filter(Guest.event_id == str(event.id), Guest.id == token_guest_id)
            .first()
        )

    if existing:
        # Returning guest: only an INCREASE in party size consumes new capacity.
        old = existing.import_count or 0
        delta = max(0, party - old)
        if delta:
            try:
                guest_crud.check_capacity_limit(db, event, delta)
            except ValueError as e:
                raise _conflict(e)
        existing.name = payload.name or existing.name
        existing.status = status
        existing.import_count = party
        existing.guest_count = party if status in GuestStatus.confirmed_values() else None
        existing.last_response = now
        if payload.notes:
            existing.notes = payload.notes
        db.add(existing)
        db.commit()
        if status in GuestStatus.confirmed_values():
            _store_answers(db, event.id, existing.id, payload.answers)
        return {"ok": True, "status": status, "updated": True, "party_size": party}

    # New guest via the open form. create_guest re-checks capacity under the same
    # advisory lock (re-entrant) before inserting.
    try:
        guest = guest_crud.create_guest(
            db,
            GuestCreate(
                event_id=event.id,
                name=payload.name,
                phone=phone_norm,
                status=status,
                import_count=party,
                guest_count=party if status in GuestStatus.confirmed_values() else None,
                notes=payload.notes,
                last_response=now,
            ),
        )
    except ValueError as e:
        # Capacity exceeded or duplicate -> 409 so the page can show a friendly msg.
        raise _conflict(e)

    if status in GuestStatus.confirmed_values():
        _store_answers(db, event.id, guest.id, payload.answers)
    return {"ok": True, "status": status, "updated": False, "guest_id": str(guest.id), "party_size": party}
