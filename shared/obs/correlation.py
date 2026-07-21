"""Correlation ID - one id that follows a flow across every service.

A correlation id is minted when a request first enters the platform (frontend
header, or the boundary that starts a flow) and then rides through:

    frontend -> Core API -> RabbitMQ message body -> workers -> Outpost ->
    Meta call -> callback -> DB writes -> logs -> Sentry

Storage is a `contextvars.ContextVar`, so it is correct under asyncio and
threads without being passed explicitly through every call. `inject_into` stamps
it onto an outgoing message dict; `adopt_from` reads it back on the consuming
side; `bind` mirrors it onto the current Sentry scope as the `correlation_id` tag
so every log and exception carries it.
"""
from __future__ import annotations

import contextvars
import uuid
from typing import Optional

CORRELATION_HEADER = "X-Correlation-ID"
CORRELATION_FIELD = "correlation_id"

_correlation_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "correlation_id", default=None)


def new_correlation_id() -> str:
    return uuid.uuid4().hex


def get_correlation_id() -> Optional[str]:
    return _correlation_id.get()


def set_correlation_id(cid: Optional[str]) -> None:
    _correlation_id.set(cid or None)
    _bind_to_sentry(cid)


def ensure_correlation_id() -> str:
    """Return the current id, minting one if none is set."""
    cid = _correlation_id.get()
    if not cid:
        cid = new_correlation_id()
        set_correlation_id(cid)
    return cid


def bind(cid: Optional[str]) -> str:
    """Adopt `cid` (or mint one) as the current correlation id and bind to Sentry."""
    cid = (cid or "").strip() or new_correlation_id()
    set_correlation_id(cid)
    return cid


def inject_into(message: dict) -> dict:
    """Stamp the current correlation id onto an outgoing message dict."""
    try:
        if isinstance(message, dict) and not message.get(CORRELATION_FIELD):
            message[CORRELATION_FIELD] = ensure_correlation_id()
    except Exception:
        pass
    return message


def adopt_from(message: dict) -> str:
    """Read a correlation id from an incoming message and make it current."""
    cid = None
    try:
        if isinstance(message, dict):
            cid = message.get(CORRELATION_FIELD) or message.get("correlationId")
    except Exception:
        cid = None
    return bind(cid)


def _bind_to_sentry(cid: Optional[str]) -> None:
    try:
        import sentry_sdk
        sentry_sdk.get_current_scope().set_tag(CORRELATION_FIELD, cid)
    except Exception:
        pass
