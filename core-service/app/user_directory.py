"""Cross-service user lookups.

core-service has no users table (users live in aub-service). These helpers call
aub-service's internal endpoints so we can invite members by phone and show
member names. All calls are best-effort and degrade gracefully (return None/{}).
"""
from __future__ import annotations

import os
import uuid
from typing import Dict, List, Optional

import httpx


def _base_and_secret():
    return os.getenv("AUB_SERVICE_URL"), os.getenv("INTERNAL_API_SECRET")


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
