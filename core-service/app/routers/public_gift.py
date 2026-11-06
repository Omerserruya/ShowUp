"""Public gift page data (UNAUTHENTICATED, whitelisted via the `/public/` prefix).

- GET /public/gift/{code} -> who the gift is for + the hosts' Bit/PayBox link
                             and/or Bit phone. Nothing else about the event.

The code is random (shared/domain/gift.py) and only ever handed out inside the
hosts' own WhatsApp messages, so the page is as private as the invitation.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.models import Event
from shared.domain.gift import format_phone, gift_ready, provider_of
from shared.domain.messaging.resolver import VariableResolver

router = APIRouter(prefix="/public/gift", tags=["public-gift"])


@router.get("/{code}")
def public_gift(code: str, db: Session = Depends(get_db)):
    if not code or len(code) > 32:
        raise HTTPException(status_code=404, detail="not_found")
    event = db.query(Event).filter(text("events.gift->>'code' = :code")).params(code=code).first()
    if event is None:
        raise HTTPException(status_code=404, detail="not_found")
    gift = event.gift or {}
    if not gift_ready(gift):
        # Link already sent, details since removed by the hosts.
        return {"available": False, "hosts": _hosts(event), "event_type": event.event_type}
    url = gift.get("url") or ""
    phone = gift.get("bit_phone") or ""
    return {
        "available": True,
        "hosts": _hosts(event),
        "event_type": event.event_type,
        "url": url or None,
        "provider": provider_of(url) if url else None,
        "bit_phone": format_phone(phone) if phone else None,
    }


def _hosts(event: Event) -> str:
    """Same host label the WhatsApp copy uses (couple / family / company)."""
    vals = VariableResolver({"subjects": event.subjects, "inviters": event.inviters or [],
                             "event_type": event.event_type}).values_for({})
    return ((vals.get("host_display_name") or "").strip() or (vals.get("host_name") or "").strip()
            or (event.name or "").strip())
