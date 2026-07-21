"""Periodic payment reconciliation trigger.

The scheduler owns *when* platform jobs run; aub-service owns iCount knowledge
and the orders table. So this module holds only the cadence and calls aub's
internal reconciliation endpoint - the recovery logic itself lives in
`aub-service/app/routers/orders.py::reconcile_pending_orders`.

What it recovers: an order moves to 'payment_pending' when the customer is sent
to the iCount PayPage. If the IPN that confirms the charge is ever lost, nothing
else in the system revisits that row - the card was charged and no event exists.
Reconciliation re-verifies such orders against iCount and provisions the ones
that really did complete, and releases claims stranded by a crashed provisioning
run.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Dict, Optional

import requests

logger = logging.getLogger(__name__)

# How often to reconcile. Payments are low-volume and the IPN is the fast path;
# this is the safety net, so a few minutes is ample.
RECONCILE_INTERVAL_SECONDS = int(os.getenv("PAYMENT_RECONCILE_INTERVAL_SECONDS", "300"))
# How long an order may sit unconfirmed before we consider its IPN lost. Must
# comfortably exceed normal PayPage completion time or we would race the customer
# while they are still typing their card details.
RECONCILE_MIN_AGE_MINUTES = int(os.getenv("PAYMENT_RECONCILE_MIN_AGE_MINUTES", "15"))

_last_run: float = 0.0


def run_payment_reconciliation(now: Optional[float] = None) -> Optional[Dict[str, Any]]:
    """Trigger reconciliation if the interval has elapsed. Returns the summary.

    Never raises: reconciliation is a safety net and must not take down the
    scheduler loop that also drives campaigns and daily summaries.
    """
    global _last_run
    now = now if now is not None else time.time()
    if now - _last_run < RECONCILE_INTERVAL_SECONDS:
        return None
    _last_run = now

    base = os.getenv("AUB_SERVICE_URL", "http://aub-service:8000").rstrip("/")
    secret = os.getenv("INTERNAL_API_SECRET")
    if not secret:
        logger.error(
            "INTERNAL_API_SECRET not set; payment reconciliation is DISABLED. "
            "Lost iCount IPNs will not be recovered."
        )
        return None

    try:
        resp = requests.post(
            f"{base}/orders/internal/reconcile",
            json={"max_age_minutes": RECONCILE_MIN_AGE_MINUTES},
            headers={"X-Internal-Secret": secret},
            timeout=60,
        )
        resp.raise_for_status()
        summary = resp.json()
    except Exception as exc:
        logger.error("payment reconciliation failed: %s", exc)
        return None

    # Only log when something actually happened - this runs forever and a
    # heartbeat every 5 minutes would bury the events that matter.
    if summary.get("provisioned") or summary.get("errors") or summary.get("unverified"):
        logger.warning("payment reconciliation: %s", summary)
    return summary
