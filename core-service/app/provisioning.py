"""The ONLY writer of an event's entitlement state.

Entitlement fields - `plan_id`, `payment_status`, `active`, `extra_rounds_allowance`
- are backend-owned. They are deliberately absent from every client-writable
schema (`EventCreate` / `EventUpdate`), so the only way they can change is
through this module, driven by aub-service's verified-payment flow via the
`/internal/provisioning/*` endpoints.

Two invariants hold the design together:

1. `active` is never assigned directly anywhere. It is derived from
   (lifecycle state, payment status) by `shared.domain.lifecycle.derive_active`,
   which is what makes every pre-existing `WHERE active` filter across the
   scheduler, campaign-worker and planner enforce payment for free.

2. Provisioning is idempotent on `provisioning_order_id`. A duplicate IPN - or a
   retry after aub crashed mid-provision - re-resolves the SAME event instead of
   creating a second one. This holds even if the caller's own locking fails,
   because the guarantee lives in a UNIQUE database constraint, not in caller
   discipline.
"""
from __future__ import annotations

import logging
import uuid
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import Event
from shared.domain.enums import EventState, PaymentStatus
from shared.domain.lifecycle import derive_active

logger = logging.getLogger(__name__)

# Plans that cost nothing. An event on one of these is settled on creation; any
# other plan requires a verified payment before it may be assigned.
FREE_PLAN_IDS = {"free", "starter", "venue"}

# The plan assigned to every self-service (non-provisioned) event. Clients cannot
# choose their own plan - a paid tier only ever arrives through provisioning.
DEFAULT_SELF_SERVICE_PLAN = "starter"


def default_payment_status(plan_id: Optional[str]) -> PaymentStatus:
    """Settlement implied by a plan alone (before any payment is verified)."""
    normalized = (plan_id or "").strip().lower()
    if not normalized or normalized in FREE_PLAN_IDS:
        return PaymentStatus.FREE
    return PaymentStatus.PENDING


def apply_entitlement(
    event: Event,
    *,
    plan_id: Optional[str] = None,
    payment_status: Optional[PaymentStatus] = None,
) -> Event:
    """Set entitlement fields on an event and re-derive `active`.

    The single choke point through which `plan_id` / `payment_status` change.
    Does not commit - the caller owns the transaction.
    """
    if plan_id is not None:
        event.plan_id = plan_id
    if payment_status is not None:
        event.payment_status = PaymentStatus.normalize(payment_status).value
    event.active = derive_active(
        getattr(event, "state", None) or EventState.ACTIVE.value,
        getattr(event, "payment_status", None),
    )
    return event


def find_provisioned_event(db: Session, order_id: str) -> Optional[Event]:
    """The event already provisioned for this order, if any (idempotency key)."""
    if not order_id:
        return None
    return db.query(Event).filter(Event.provisioning_order_id == str(order_id)).first()


# NOTE: event CREATION for a verified payment used to live here as
# `provision_event`. It now goes through `entitlement_service.issue_and_redeem`
# (source=PAYMENT), so payment is just one entitlement issuer and there is a
# single event-construction path. This module keeps only the entitlement-FIELD
# writer helpers (apply_entitlement / derive_active / find_provisioned_event) and
# the upgrade path (change_plan), which modifies an existing event rather than
# creating one and so is not an entitlement redemption.


def change_plan(db: Session, event: Event, *, plan_id: str, order_id: str) -> Event:
    """Apply a purchased plan change to an existing event. Idempotent per order.

    Used for upgrades. The event is marked PAID because the caller only reaches
    here after payment verification.

    `provisioning_order_id` is deliberately NOT touched: it is the key for the
    order that CREATED this event. Overwriting it would make that original order
    look unprovisioned, so a replayed or reconciled IPN for the first purchase
    would create a SECOND, duplicate event. Plan-change replays are tracked
    separately by `last_plan_order_id`.
    """
    if order_id and str(getattr(event, "last_plan_order_id", "") or "") == str(order_id):
        return event  # replay of the same plan-change order - nothing to do
    apply_entitlement(event, plan_id=plan_id, payment_status=PaymentStatus.PAID)
    if order_id:
        event.last_plan_order_id = str(order_id)
    db.add(event)
    db.commit()
    db.refresh(event)
    logger.info("event %s plan changed to %s (order %s)", event.id, plan_id, order_id)
    return event


def resync_active(db: Session, event: Event) -> Event:
    """Re-derive `active` after a lifecycle transition. Commits."""
    event.active = derive_active(
        getattr(event, "state", None), getattr(event, "payment_status", None)
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event
