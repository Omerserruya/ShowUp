"""Error boundaries - send unexpected failures to Sentry, never the expected ones.

The rule from the spec: unexpected failures must always reach Sentry; expected
business-validation errors must NOT become Sentry errors. `is_expected` encodes
that by exception CLASS NAME (matched by name so this module need not import
every service's domain types), covering:

* framework validation / handled HTTP: HTTPException, RequestValidationError, ...
* domain validation raised on purpose: EntitlementNotRedeemable, EntitlementError,
  ToolDenied, ToolError, PlanLookupUnavailable, InviteTokenSecretMissing,
  IpnSecretMissing, and the ValueError our CRUD raises for capacity/duplicates.

`capture` is the single choke point for reporting - call it once at a boundary
(a worker's message handler, an external-call wrapper). It dedupes implicitly:
Sentry's own Dedupe integration collapses identical stacks, and because reporting
happens once at the outermost boundary we do not double-report. `operation()`
wraps a block so any unexpected exception is captured with flow context attached,
then re-raised for the caller's own control flow.
"""
from __future__ import annotations

import contextlib
import logging
from typing import Optional

from . import context as _context

logger = logging.getLogger("obs.boundary")

# Exception class names that are EXPECTED business/validation outcomes - reported
# to logs if at all, never to Sentry as errors.
EXPECTED_EXCEPTION_NAMES = {
    "HTTPException", "RequestValidationError", "ResponseValidationError",
    "StarletteHTTPException", "ValidationError",
    "EntitlementError", "EntitlementNotRedeemable",
    "PlanLookupUnavailable", "InviteTokenSecretMissing", "IpnSecretMissing",
    "ToolDenied", "ToolError",
    "ValueError",   # our CRUD uses ValueError for capacity/duplicate business rules
}


def is_expected(exc: BaseException) -> bool:
    for cls in type(exc).__mro__:
        if cls.__name__ in EXPECTED_EXCEPTION_NAMES:
            return True
    return False


def capture(exc: BaseException, *, level: str = "error", expected_ok: bool = True,
            **ctx) -> Optional[str]:
    """Report an UNEXPECTED exception to Sentry with context. Returns event id.

    Expected business errors are skipped (returns None) unless `expected_ok`
    is False. Any keyword context is attached before capture.
    """
    if expected_ok and is_expected(exc):
        return None
    # Attach any last-moment context (flow/operation/ids) provided by the caller.
    if ctx:
        _context.set_flow(operation=ctx.pop("operation", None), flow=ctx.pop("flow", None),
                          worker=ctx.pop("worker", None))
        for k, v in ctx.items():
            _context._set_tags(**{k: v})
    try:
        import sentry_sdk
        return sentry_sdk.capture_exception(exc)
    except Exception:
        # No SDK / not initialized - degrade quietly (debug, not a noisy stacktrace).
        logger.debug("Sentry capture skipped (SDK unavailable)")
        return None


def capture_message(message: str, *, level: str = "error", **ctx) -> Optional[str]:
    """Report a noteworthy non-exception condition (e.g. a Meta rejection)."""
    if ctx:
        for k, v in ctx.items():
            _context._set_tags(**{k: v})
    try:
        import sentry_sdk
        return sentry_sdk.capture_message(message, level=level)
    except Exception:
        return None


@contextlib.contextmanager
def operation(name: str, *, flow: Optional[str] = None, worker: Optional[str] = None,
              reraise: bool = True, **tags):
    """Run a block as a named operation.

    Sets flow/operation/worker + any tags on the scope, and on an UNEXPECTED
    exception captures it (with context) before optionally re-raising. Expected
    business errors pass straight through, uncaptured.
    """
    _context.set_flow(operation=name, flow=flow, worker=worker)
    if tags:
        _context._set_tags(**tags)
    try:
        yield
    except BaseException as exc:
        if not is_expected(exc):
            capture(exc)
        if reraise:
            raise
