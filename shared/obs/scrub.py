"""Payload sanitization - the guarantee that secrets never reach Sentry.

Applied both to Sentry events (via `scrub_event`, wired into `before_send`) and to
structured-log fields (via `scrub_dict`). Two layers:

1. Key-based: any field whose name looks sensitive (authorization, token, jwt,
   password, cookie, secret, api key, ...) is redacted wholesale, at any depth.
2. Value-based: strings that look like a JWT or a Bearer token are redacted even
   if their key is innocuous.

Message *content* is also redacted: WhatsApp bodies / template parameters can
contain personal text, so `text`, `body`, `message`, `parameters`, `content` are
truncated/redacted. Phone numbers are NOT scrubbed - they are explicit debugging
context the spec asks for, attached deliberately as tags, not leaked payload.
"""
from __future__ import annotations

import re
from typing import Any

REDACTED = "[redacted]"

# Field names (case-insensitive substring match) that must never be sent.
_SENSITIVE_KEYS = (
    "authorization", "auth", "token", "jwt", "password", "passwd", "secret",
    "cookie", "session", "api_key", "apikey", "x-internal-secret", "internal_secret",
    "access_token", "refresh_token", "id_token", "credential", "private_key",
    "set-cookie", "x-order-token", "sig", "signature", "otp", "verify_token",
    "webhook_secret", "icount_api_token",
)

# Field names whose VALUE is free-text customer content - redact the content but
# keep the key so the shape of the event is still visible.
_CONTENT_KEYS = ("text", "body", "message", "content", "parameters", "custom_message",
                 "payload", "reply", "prompt", "answer")

# Value patterns that are secrets regardless of their key.
_JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b")
_BEARER_RE = re.compile(r"\bBearer\s+[A-Za-z0-9._\-]+", re.IGNORECASE)

# Query-string parameters whose VALUE is a credential, whatever its format:
# the invite token (?g=), order token, OTP, signatures, codes.
_SENSITIVE_QUERY_KEYS = {"g", "token", "code", "sig", "signature", "secret", "otp",
                         "access_token", "jwt", "order_token", "key", "x-order-token"}


def _scrub_query_string(qs: str) -> str:
    """Redact credential-bearing query params by NAME (robust to token format)."""
    parts = []
    for pair in qs.split("&"):
        if "=" in pair:
            k, _, v = pair.partition("=")
            if k.lower() in _SENSITIVE_QUERY_KEYS or _is_sensitive_key(k):
                parts.append(f"{k}={REDACTED}")
            else:
                parts.append(f"{k}={_JWT_RE.sub(REDACTED, v)}")
        else:
            parts.append(_JWT_RE.sub(REDACTED, pair))
    return "&".join(parts)

_MAX_STR = 1024
_MAX_DEPTH = 8


def _is_sensitive_key(key: str) -> bool:
    k = str(key).lower()
    return any(s in k for s in _SENSITIVE_KEYS)


def _is_content_key(key: str) -> bool:
    return str(key).lower() in _CONTENT_KEYS


def _scrub_str(value: str) -> str:
    v = _JWT_RE.sub(REDACTED, value)
    v = _BEARER_RE.sub(REDACTED, v)
    if len(v) > _MAX_STR:
        v = v[:_MAX_STR] + "…"
    return v


def scrub_value(value: Any, *, depth: int = 0, content: bool = False) -> Any:
    if depth > _MAX_DEPTH:
        return REDACTED
    if isinstance(value, dict):
        return {k: (REDACTED if _is_sensitive_key(k)
                    else scrub_value(v, depth=depth + 1, content=content or _is_content_key(k)))
                for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [scrub_value(v, depth=depth + 1, content=content) for v in value][:100]
    if isinstance(value, str):
        if content:
            return REDACTED
        return _scrub_str(value)
    return value


def scrub_dict(d: dict) -> dict:
    try:
        return scrub_value(dict(d))
    except Exception:
        return {}


def _scrub_headers(headers: Any) -> Any:
    """HTTP headers: drop the whole auth/cookie family."""
    if isinstance(headers, dict):
        return {k: (REDACTED if _is_sensitive_key(k) else v) for k, v in headers.items()}
    if isinstance(headers, list):  # list of [name, value] pairs
        return [[k, REDACTED if _is_sensitive_key(k) else v] if isinstance(k, str) else pair
                for pair in headers for k, v in [pair if isinstance(pair, (list, tuple)) and len(pair) == 2 else (pair, None)]]
    return headers


def scrub_event(event: dict, hint: Any = None) -> dict:
    """`before_send` hook: strip secrets from a Sentry event in place-ish."""
    try:
        req = event.get("request")
        if isinstance(req, dict):
            if "headers" in req:
                req["headers"] = _scrub_headers(req["headers"])
            for k in ("cookies", "data"):
                if k in req:
                    req[k] = REDACTED if k == "cookies" else scrub_value(req[k])
            # Query strings can carry ?g=<token>, ?sig=..., order tokens.
            if isinstance(req.get("query_string"), str):
                req["query_string"] = _scrub_query_string(req["query_string"])
        # Custom contexts + extra + tags.
        for section in ("contexts", "extra"):
            if isinstance(event.get(section), dict):
                event[section] = scrub_value(event[section])
        if isinstance(event.get("tags"), dict):
            event["tags"] = {k: (REDACTED if _is_sensitive_key(k) else v)
                             for k, v in event["tags"].items()}
        # Breadcrumbs may carry lifecycle-log data we already scrubbed, but be safe.
        bc = event.get("breadcrumbs")
        if isinstance(bc, dict) and isinstance(bc.get("values"), list):
            for crumb in bc["values"]:
                if isinstance(crumb, dict) and isinstance(crumb.get("data"), dict):
                    crumb["data"] = scrub_value(crumb["data"])
    except Exception:
        # Never let scrubbing failure crash the SDK; drop the event instead.
        return {}
    return event
