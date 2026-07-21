"""Shared guard for service-to-service (`/internal/*`) endpoints.

`/internal/` is exempt from the JWT AuthMiddleware (see `app/main.py`) and is not
exposed through nginx, so every handler under that prefix MUST call
`require_internal_secret` itself. This module is the single implementation; do
not re-inline the check in individual routers.
"""
from __future__ import annotations

import hmac
import logging
import os
from typing import Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)


def require_internal_secret(x_internal_secret: Optional[str]) -> None:
    """Authenticate an internal caller, or raise.

    A missing `INTERNAL_API_SECRET` is a misconfiguration rather than an attack:
    fail closed with a distinct 503 so it is diagnosable instead of silently
    behaving as if every caller were authorized.

    The comparison is constant-time - the secret is a fixed value reused across
    many calls, so a naive `!=` leaks it byte-by-byte to a timing attacker.
    """
    expected = os.getenv("INTERNAL_API_SECRET")
    if not expected:
        logger.error(
            "INTERNAL_API_SECRET is not set on core-service; rejecting internal "
            "call. Service-to-service provisioning is disabled until it is set."
        )
        raise HTTPException(status_code=503, detail="internal auth not configured")
    if not hmac.compare_digest(str(x_internal_secret or ""), str(expected)):
        raise HTTPException(status_code=403, detail="forbidden")
