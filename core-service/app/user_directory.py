"""Cross-service user lookups.

core-service has no users table (users live in aub-service). These helpers call
aub-service's internal endpoints so we can invite members by phone and show
member names. All calls are best-effort and degrade gracefully (return None/{}).
"""
from __future__ import annotations

import logging
import os
import uuid
from typing import Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)


def _base_and_secret():
    """(AUB_SERVICE_URL, INTERNAL_API_SECRET). Warns clearly on missing config so
    a mis-set env surfaces in logs instead of silently disabling the feature."""
    base = os.getenv("AUB_SERVICE_URL")
    secret = os.getenv("INTERNAL_API_SECRET")
    if not base:
        logger.error("AUB_SERVICE_URL is not set; cross-service user calls disabled.")
    if not secret:
        logger.error(
            "INTERNAL_API_SECRET is not set on core-service; internal calls to "
            "aub will be rejected (venue owner provisioning / welcome disabled)."
        )
    return base, secret


def resolve_user_id_by_phone(phone: str) -> Optional[dict]:
    """Return {user_id, first_name, last_name, phone} for a registered phone, or None."""
    base, secret = _base_and_secret()
    if not base:
        return None
    try:
        r = httpx.get(
            f"{base.rstrip('/')}/auth/internal/user-by-phone",
            params={"phone": phone},
            headers={"X-Internal-Secret": secret or ""},
            timeout=5.0,
        )
        return r.json() if r.status_code == 200 else None
    except Exception:
        return None


def ensure_user_by_phone(
    phone: str, first_name: str, last_name: str, email: Optional[str] = None
) -> Optional[dict]:
    """Create-or-get a user by phone in aub-service. Returns
    {user_id, first_name, last_name, phone} or None on failure.

    Used by the venue flow: the venue admin creates an event for an owner who may
    not have an account yet, so aub provisions the owner user (verified, since a
    partner venue vouches for them) and returns its id."""
    base, secret = _base_and_secret()
    if not base:
        return None
    try:
        r = httpx.post(
            f"{base.rstrip('/')}/auth/internal/ensure-user",
            json={
                "phone": phone,
                "first_name": first_name,
                "last_name": last_name,
                "email": email,
            },
            headers={"X-Internal-Secret": secret or ""},
            timeout=8.0,
        )
        if r.status_code != 200:
            logger.error(
                "ensure_user_by_phone failed: aub returned %s (%s). Venue event "
                "owner could not be provisioned.", r.status_code, r.text[:200],
            )
            return None
        return r.json()
    except Exception as exc:
        logger.exception("ensure_user_by_phone errored calling aub: %s", exc)
        return None


def notify_venue_welcome(
    phone: str, venue_name: str, event_id: Optional[str] = None, first_name: Optional[str] = None
) -> None:
    """Best-effort: ask aub-service to send the WhatsApp welcome for a newly
    created venue event. Swallows all errors (never blocks event creation)."""
    base, secret = _base_and_secret()
    if not base:
        return
    try:
        r = httpx.post(
            f"{base.rstrip('/')}/auth/internal/notify/venue-welcome",
            json={
                "phone": phone,
                "venue_name": venue_name,
                "event_id": event_id,
                "first_name": first_name,
            },
            headers={"X-Internal-Secret": secret or ""},
            timeout=8.0,
        )
        if r.status_code != 200:
            logger.error(
                "venue welcome WhatsApp not sent: aub returned %s (%s) for event %s.",
                r.status_code, r.text[:200], event_id,
            )
    except Exception as exc:
        # Never block event creation, but do not fail silently either.
        logger.warning("venue welcome WhatsApp failed for event %s: %s", event_id, exc)


def resolve_users_by_ids(ids: List[uuid.UUID]) -> Dict[str, dict]:
    """Map str(user_id) -> {first_name, last_name, phone}. Empty dict on any failure."""
    base, secret = _base_and_secret()
    if not base or not ids:
        return {}
    try:
        r = httpx.post(
            f"{base.rstrip('/')}/auth/internal/users",
            json={"ids": [str(i) for i in ids]},
            headers={"X-Internal-Secret": secret or ""},
            timeout=5.0,
        )
        if r.status_code != 200:
            return {}
        return {u["user_id"]: u for u in r.json().get("users", [])}
    except Exception:
        return {}
