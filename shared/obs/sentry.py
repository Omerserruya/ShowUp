"""Sentry initialization - one env-driven entry point for every service.

`init_sentry(service_name)` is called once at each service's startup. It:

* reads DSN / environment / release from env (never hardcoded); if there is no
  DSN it is a NO-OP beyond stdout structured logging, so dev/test/CI run
  unchanged and nothing crashes when Sentry is not configured;
* tags every event with `service`, `environment`, `release`;
* installs `before_send` (secret scrubbing + drop noise) and
  `before_send_transaction` (drop health checks / successful traffic), so
  performance and PII rules from the spec hold globally rather than per-call;
* keeps `send_default_pii=False` and a small request-body cap.

Sentry Logs are enabled via the SDK's logs experiment when the installed SDK
supports it; `obs.logging.log_event` uses them, falling back to breadcrumbs +
stdout otherwise.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from .scrub import scrub_event

logger = logging.getLogger("obs.sentry")

_service_name: Optional[str] = None
_initialized = False

# Transaction names that are pure noise - never trace them.
_NOISE_TRANSACTIONS = ("/healthz", "/health", "GET /healthz", "/metrics", "/favicon.ico")


def service_name() -> Optional[str]:
    return _service_name


def _env(*names: str, default: Optional[str] = None) -> Optional[str]:
    for n in names:
        v = os.getenv(n)
        if v:
            return v
    return default


def _before_send(event, hint):
    # Secret scrubbing is mandatory and last-line: if it fails, drop the event.
    scrubbed = scrub_event(event, hint)
    return scrubbed or None


def _before_send_transaction(event, hint):
    name = (event or {}).get("transaction") or ""
    if any(n in name for n in _NOISE_TRANSACTIONS):
        return None
    return event


def init_sentry(service: str, *, component: str = "service") -> bool:
    """Initialize Sentry for `service`. Returns True if the SDK was armed.

    Idempotent per process. Safe to call with no DSN (returns False, no error).
    """
    global _service_name, _initialized
    _service_name = service
    if _initialized:
        return True

    dsn = os.getenv("SENTRY_DSN")
    if not dsn:
        logger.info("SENTRY_DSN unset; Sentry disabled for %s (stdout logging only)", service)
        _initialized = True
        return False

    try:
        import sentry_sdk
    except Exception as exc:  # SDK not installed - degrade, don't crash
        logger.warning("sentry-sdk not importable (%s); Sentry disabled for %s", exc, service)
        _initialized = True
        return False

    environment = _env("SENTRY_ENVIRONMENT", "ENVIRONMENT", "APP_ENV", default="production")
    release = _env("SENTRY_RELEASE", "RELEASE", "SERVICE_VERSION", "GIT_SHA")
    traces = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.0"))

    kwargs = dict(
        dsn=dsn,
        environment=environment,
        release=release,
        server_name=service,
        traces_sample_rate=traces,      # 0 by default: no successful-request perf noise
        send_default_pii=False,         # never auto-attach headers/cookies/body
        max_request_body_size="small",
        before_send=_before_send,
        before_send_transaction=_before_send_transaction,
        attach_stacktrace=True,
    )
    # Enable Sentry structured Logs on SDKs that support the experiment.
    try:
        kwargs["_experiments"] = {"enable_logs": True}
    except Exception:
        pass

    try:
        sentry_sdk.init(**kwargs)
        scope = sentry_sdk.get_global_scope()
        scope.set_tag("service", service)
        scope.set_tag("component", component)
    except Exception as exc:
        logger.warning("sentry_sdk.init failed for %s: %s", service, exc)
        _initialized = True
        return False

    logger.info("Sentry initialized: service=%s env=%s release=%s", service, environment, release)
    _initialized = True
    return True
