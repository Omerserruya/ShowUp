"""Usage metering + limit enforcement (Phase 10).

Records billable events to the ledger and answers "would this exceed the limit".
Guests and rounds are customer-facing limits; messages are metered for internal
cost analysis only (never enforced as a customer quota).
"""
from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.models import UsageEvent
from shared.domain.enums import UsageMetric


def record_usage(
    db: Session,
    *,
    account_id,
    event_id,
    metric: UsageMetric,
    quantity: int = 1,
    ref_id: Optional[uuid.UUID] = None,
    commit: bool = True,
) -> UsageEvent:
    entry = UsageEvent(
        account_id=account_id,
        event_id=event_id,
        metric=metric.value if isinstance(metric, UsageMetric) else str(metric),
        quantity=quantity,
        ref_id=ref_id,
    )
    db.add(entry)
    if commit:
        db.commit()
        db.refresh(entry)
    return entry


def event_usage_total(db: Session, event_id, metric: UsageMetric) -> int:
    """Total metered usage of one metric for ONE event.

    This is the immutable counterpart to counting live rows. Round entitlement
    used to be `COUNT(campaigns)`, which meant deleting a campaign handed the
    paid round back - billing usage that could be un-spent. The ledger is
    append-only, so consumption here behaves like metered billing: once a round
    is launched it stays consumed, whatever later happens to the campaign row.
    """
    if event_id is None:
        return 0
    m = metric.value if isinstance(metric, UsageMetric) else str(metric)
    total = (
        db.query(func.coalesce(func.sum(UsageEvent.quantity), 0))
        .filter(UsageEvent.event_id == event_id, UsageEvent.metric == m)
        .scalar()
    )
    return int(total or 0)


def usage_total(db: Session, account_id, metric: UsageMetric) -> int:
    if account_id is None:
        return 0
    m = metric.value if isinstance(metric, UsageMetric) else str(metric)
    total = (
        db.query(func.coalesce(func.sum(UsageEvent.quantity), 0))
        .filter(UsageEvent.account_id == account_id, UsageEvent.metric == m)
        .scalar()
    )
    return int(total or 0)


def would_exceed(db: Session, account_id, metric: UsageMetric, limit: Optional[int], additional: int = 1) -> bool:
    """True if recording `additional` would push usage past `limit`.

    limit None means unlimited (never exceeds). account_id None (legacy events)
    is treated as unmetered -> never exceeds.
    """
    if limit is None or account_id is None:
        return False
    return usage_total(db, account_id, metric) + additional > limit
