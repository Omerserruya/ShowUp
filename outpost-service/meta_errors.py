"""Meta Graph API error parsing + classification.

Meta reports *why* a send failed in the JSON body ({"error": {"code": ..., ...}}),
not in the HTTP status. The previous code stored `http_400` for everything, so a
rate limit, an expired token and a bad phone number all looked the same and
were all treated as permanent failures. This module turns a response into a
`MetaSendError` with a stable `error_code` ("meta_131056") and a `kind` that
drives what the consumer does next:

    RETRYABLE  transient - re-deliver later via the retry queues (backoff).
    ACCOUNT    the whole WABA / token is unusable - open the circuit breaker,
               stop draining the campaign queue, page ops.
    TEMPLATE   one template cannot be sent right now (missing / paused /
               disabled) - trip a per-template breaker and park its messages
               on the retry queues instead of burning them.
    PERMANENT  this message will never succeed (bad number, bad params) -
               record failed and move on.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

RETRYABLE = "retryable"
ACCOUNT = "account"
TEMPLATE = "template"
PERMANENT = "permanent"

# Throughput / transient server-side conditions. Retrying later succeeds.
RETRYABLE_CODES = {
    1,        # API unknown (transient)
    2,        # API service temporarily unavailable
    4,        # application request limit reached
    80007,    # WABA rate limit
    130429,   # cloud API throughput rate limit
    131000,   # something went wrong (generic, transient)
    131016,   # service unavailable
    131048,   # spam rate limit (too many messages to unengaged users)
    131056,   # pair rate limit (same sender/recipient pair too fast)
    133004,   # server temporarily unavailable
}

# The account / credentials are unusable: every further send fails the same way.
ACCOUNT_CODES = {
    190,      # access token expired / invalid
    368,      # temporarily blocked for policy violations
    131031,   # business account locked / restricted
    131042,   # business eligibility (payment) issue
}

# One template is not sendable right now.
TEMPLATE_CODES = {
    132001,   # template does not exist (in this language)
    132015,   # template paused (low quality)
    132016,   # template disabled
}


class MetaSendError(Exception):
    """A send that Meta (or the transport) refused."""

    def __init__(self, *, kind: str, error_code: str, detail: str = "",
                 status_code: Optional[int] = None, meta_code: Optional[int] = None):
        super().__init__(f"{error_code}: {detail}"[:500])
        self.kind = kind
        self.error_code = error_code
        self.detail = (detail or "")[:500]
        self.status_code = status_code
        self.meta_code = meta_code

    @property
    def retryable(self) -> bool:
        return self.kind == RETRYABLE


def classify(status_code: Optional[int], meta_code: Optional[int]) -> str:
    if meta_code in ACCOUNT_CODES:
        return ACCOUNT
    if meta_code in TEMPLATE_CODES:
        return TEMPLATE
    if meta_code in RETRYABLE_CODES:
        return RETRYABLE
    if status_code is not None:
        if status_code == 401:
            return ACCOUNT          # bad/expired token even without a parsed code
        if status_code == 429 or status_code >= 500:
            return RETRYABLE
    return PERMANENT


def _int_or_none(v: Any) -> Optional[int]:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def from_response(status_code: int, body: Any, text: str = "") -> MetaSendError:
    """Build the error from a non-2xx Graph API response."""
    err: Dict[str, Any] = {}
    if isinstance(body, dict):
        err = body.get("error") or {}
    meta_code = _int_or_none(err.get("code"))
    parts = [str(err.get("message") or ""),
             str((err.get("error_data") or {}).get("details") or "")]
    detail = " | ".join(p for p in parts if p) or (text or "")[:500]
    error_code = f"meta_{meta_code}" if meta_code is not None else f"http_{status_code}"
    return MetaSendError(kind=classify(status_code, meta_code), error_code=error_code,
                         detail=detail, status_code=status_code, meta_code=meta_code)


def from_transport(exc: BaseException) -> MetaSendError:
    """Network errors / timeouts never reached a Meta decision - always retryable."""
    return MetaSendError(kind=RETRYABLE, error_code=f"net_{type(exc).__name__}"[:100],
                         detail=str(exc)[:500])
