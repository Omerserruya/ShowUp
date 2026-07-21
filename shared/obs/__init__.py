"""ShowUp observability layer - one import surface for every service.

    from shared.obs import init_sentry, log_event, correlation, context, boundary

Design principles:
* env-driven, never hardcoded; a missing SENTRY_DSN is a clean no-op.
* defensive everywhere - instrumentation must never crash a caller.
* unexpected failures reach Sentry; expected business errors do not.
* one correlation id follows a flow across services; every log and exception
  carries it plus the who/what/where context.
"""
from __future__ import annotations

from . import boundary, context, correlation
from . import logging as events
from .boundary import capture, capture_message, is_expected, operation
from .context import (
    clear_context, set_ai, set_campaign, set_event, set_external, set_flow,
    set_guest, set_payment, set_user, set_whatsapp,
)
from .correlation import (
    CORRELATION_FIELD, CORRELATION_HEADER, adopt_from, bind as bind_correlation,
    ensure_correlation_id, get_correlation_id, inject_into, new_correlation_id,
    set_correlation_id,
)
from .logging import log_event
from .sentry import init_sentry, service_name


def bootstrap(service: str, *, component: str = "service") -> None:
    """One-call startup for a service: arm Sentry + start the ops heartbeat.

    Both are best-effort and independent - a failure in one never blocks the
    other or the service. Call once at each service's entry point.
    """
    try:
        init_sentry(service, component=component)
    except Exception:
        pass
    try:
        from shared.ops.heartbeat import start_heartbeat
        start_heartbeat(service)
    except Exception:
        pass

__all__ = [
    "init_sentry", "service_name", "bootstrap",
    "log_event", "events",
    "correlation", "context", "boundary",
    "capture", "capture_message", "is_expected", "operation",
    "set_user", "set_event", "set_campaign", "set_guest", "set_whatsapp",
    "set_payment", "set_ai", "set_external", "set_flow", "clear_context",
    "get_correlation_id", "set_correlation_id", "new_correlation_id",
    "ensure_correlation_id", "bind_correlation", "inject_into", "adopt_from",
    "CORRELATION_HEADER", "CORRELATION_FIELD",
]
