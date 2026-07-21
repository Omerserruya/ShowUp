"""Structured lifecycle logging - meaningful operational events only.

`log_event(name, **fields)` emits ONE structured record for a lifecycle event
(campaign started/completed/failed, payment started/completed/failed, import,
webhook, worker job, retry, external API, queue processing). It is NOT for
per-request or debug logging - that noise is deliberately excluded per the spec.

Each record automatically carries `service`, `correlation_id` and the current
flow context (event/campaign/guest/... set via obs.context), so a lifecycle log
is self-describing. Output goes to:

* stdout as JSON (always - so logs work with or without Sentry),
* a Sentry breadcrumb (so the trail is attached to any later exception),
* Sentry Logs when the SDK supports them.

Fields are scrubbed before emission, so a stray token or message body in a field
never leaks.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from . import sentry as _sentry
from .context import current_context
from .correlation import get_correlation_id
from .scrub import scrub_dict

# Canonical lifecycle event names (use these constants, not free strings).
CAMPAIGN_STARTED = "campaign.started"
CAMPAIGN_COMPLETED = "campaign.completed"
CAMPAIGN_FAILED = "campaign.failed"
PAYMENT_STARTED = "payment.started"
PAYMENT_COMPLETED = "payment.completed"
PAYMENT_FAILED = "payment.failed"
IMPORT_STARTED = "import.started"
IMPORT_COMPLETED = "import.completed"
IMPORT_FAILED = "import.failed"
WEBHOOK_RECEIVED = "webhook.received"
WEBHOOK_PROCESSED = "webhook.processed"
WORKER_PICKED = "worker.picked_job"
WORKER_COMPLETED = "worker.completed_job"
RETRY_SCHEDULED = "retry.scheduled"
RETRY_EXHAUSTED = "retry.exhausted"
EXTERNAL_REQUEST = "external.request"
EXTERNAL_RESPONSE = "external.response"
QUEUE_PROCESSING = "queue.processing"

_stdout = logging.getLogger("obs.events")

_LEVELS = {"debug": logging.DEBUG, "info": logging.INFO,
           "warning": logging.WARNING, "error": logging.ERROR, "critical": logging.CRITICAL}


def log_event(event: str, *, level: str = "info", **fields: Any) -> None:
    """Emit one structured lifecycle event. `level` in debug|info|warning|error."""
    payload = {
        "event": event,
        "service": _sentry.service_name(),
        "correlation_id": get_correlation_id(),
    }
    payload.update(current_context())
    payload.update({k: v for k, v in fields.items() if v is not None})
    payload = scrub_dict(payload)

    lvl = _LEVELS.get(level, logging.INFO)
    try:
        _stdout.log(lvl, json.dumps(payload, default=str, ensure_ascii=False))
    except Exception:
        _stdout.log(lvl, "%s %s", event, payload)

    # Breadcrumb so this lifecycle step is attached to any later exception.
    try:
        import sentry_sdk
        sentry_sdk.add_breadcrumb(category="lifecycle", type="default",
                                  message=event, level=level, data=payload)
    except Exception:
        pass

    # Sentry structured Logs, when the installed SDK exposes them.
    try:
        from sentry_sdk import logger as _slog  # available on SDKs with logs enabled
        fn = getattr(_slog, level, None) or getattr(_slog, "info", None)
        if fn:
            fn(event, attributes={k: v for k, v in payload.items() if v is not None})
    except Exception:
        pass
