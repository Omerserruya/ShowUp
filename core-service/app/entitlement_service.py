"""Entitlement domain service - issue and redeem the right to create an event.

An Entitlement is the single answer to "why may this user create this event?".
Payment is one issuer; venue pools, beta, admin grants and promotions are others.
This module is the one place entitlements are minted and consumed, so every
event-creation path shares identical, race-safe, audited behaviour rather than
each growing its own copy.

Two entry shapes:

* `issue()` mints an AVAILABLE entitlement and returns it with its code, for
  distribution as a redemption link (venue pool, beta batch, admin grant).
* `redeem()` consumes an AVAILABLE entitlement, atomically, and creates the one
  event it authorises. `issue_and_redeem()` chains the two for the auto paths
  (payment, self-service, clone, admin/venue direct-create) where the issuer
  already holds the event details and no link is handed out.

Both consumption routes funnel through the SAME atomic claim, so "one code, one
event" is guaranteed by a conditional UPDATE, not by caller discipline.
"""
from __future__ import annotations

import logging
import secrets
import uuid
from typing import Any, Dict, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.models import Entitlement, Event
from app.plans_client import plan_count_limit
from app.provisioning import apply_entitlement, find_provisioned_event
from shared.domain.enums import EntitlementSource, EntitlementStatus, EventState, PaymentStatus
from shared.domain.rounds import included_rounds

logger = logging.getLogger(__name__)

# Event fields an issuer/redeemer may supply. Entitlement fields (plan, limits)
# are decided here from the entitlement, never taken from this payload.
_EVENT_FIELDS = ("name", "description", "event_date", "location", "inviters",
                 "event_type", "subjects")


class EntitlementError(Exception):
    """Base for entitlement failures."""


class EntitlementNotRedeemable(EntitlementError):
    """The code cannot be redeemed. `reason` is a machine token for the caller."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def generate_code() -> str:
    """A cryptographically random, unguessable, URL-safe redemption code.

    256 bits of entropy - brute-forcing the space is infeasible, so the code
    itself is the redemption credential (like a password-reset token).
    """
    return secrets.token_urlsafe(32)


def _settlement_for_source(source: EntitlementSource) -> PaymentStatus:
    """The event settlement implied by an entitlement's issuer.

    Only a PAYMENT entitlement means money was received (PAID). Every other
    issuer GRANTS the event, so nothing is owed and it is FREE - either way the
    event is settled, hence active. This is the only place the mapping lives.
    """
    return PaymentStatus.PAID if source == EntitlementSource.PAYMENT else PaymentStatus.FREE


def _clean_event_fields(fields: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    fields = fields or {}
    out = {k: fields.get(k) for k in _EVENT_FIELDS if fields.get(k) is not None}
    if not out.get("name"):
        raise EntitlementError("event name is required")
    inviters = out.get("inviters")
    if inviters is not None and not isinstance(inviters, list):
        out["inviters"] = []
    # Normalise inviter dicts to the {fn, ln} shape the event stores.
    if isinstance(out.get("inviters"), list):
        out["inviters"] = [
            {"fn": i.get("fn"), "ln": i.get("ln")} if isinstance(i, dict) else i
            for i in out["inviters"]
        ]
    return out


def issue(
    db: Session,
    *,
    source: EntitlementSource,
    plan_id: str,
    created_by: Optional[uuid.UUID] = None,
    account_id: Optional[uuid.UUID] = None,
    max_guests: Optional[int] = None,
    campaign_rounds: Optional[int] = None,
    expires_at=None,
    metadata: Optional[dict] = None,
    order_id: Optional[str] = None,
    commit: bool = True,
) -> Entitlement:
    """Mint one AVAILABLE entitlement. The caller owns distribution of its code."""
    source = EntitlementSource.normalize(source)
    plan_id = (plan_id or "").strip().lower()
    if not plan_id:
        raise EntitlementError("plan_id is required to issue an entitlement")
    ent = Entitlement(
        code=generate_code(),
        status=EntitlementStatus.AVAILABLE.value,
        source=source.value,
        plan_id=plan_id,
        max_guests=max_guests,
        campaign_rounds=campaign_rounds,
        expires_at=expires_at,
        created_by=created_by,
        account_id=account_id,
        order_id=order_id,
        entitlement_metadata=metadata or None,
    )
    db.add(ent)
    if commit:
        db.commit()
        db.refresh(ent)
    else:
        db.flush()
    return ent


def _build_event(
    db: Session,
    *,
    claim,
    owner_user_id: uuid.UUID,
    account_id: Optional[uuid.UUID],
    event_fields: Dict[str, Any],
    order_id: Optional[str],
) -> Event:
    """Construct the one event an entitlement authorises. Does not commit.

    `claim` is the row returned by the atomic redeem UPDATE (id, plan_id,
    max_guests, campaign_rounds, source).
    """
    source = EntitlementSource.normalize(claim["source"])
    event = Event(
        owners=[str(owner_user_id)],
        account_id=account_id,
        state=EventState.ACTIVE.value,
        entitlement_id=claim["id"],
        # Payment idempotency key rides along ONLY for payment orders.
        provisioning_order_id=str(order_id) if order_id else None,
        # Per-event limit overrides snapshot from the entitlement (NULL => plan default).
        max_guests_override=claim["max_guests"],
        included_rounds_override=claim["campaign_rounds"],
        **_clean_event_fields(event_fields),
    )
    apply_entitlement(event, plan_id=claim["plan_id"], payment_status=_settlement_for_source(source))
    db.add(event)
    db.flush()  # assign event.id for the back-link
    return event


def _classify_unredeemable(db: Session, code: str) -> str:
    """Why a claim failed - for the code holder's error message (not a leak)."""
    row = db.execute(
        text("SELECT status, expires_at FROM entitlements WHERE code = :c"),
        {"c": code},
    ).mappings().first()
    if row is None:
        return "not_found"
    status = EntitlementStatus.normalize(row["status"])
    if status == EntitlementStatus.REDEEMED:
        return "already_redeemed"
    if status == EntitlementStatus.CANCELLED:
        return "cancelled"
    if status == EntitlementStatus.EXPIRED or (
        row["expires_at"] is not None and _expired(row["expires_at"])
    ):
        return "expired"
    return "unavailable"


def _expired(expires_at) -> bool:
    import datetime as dt
    if expires_at is None:
        return False
    now = dt.datetime.now(dt.timezone.utc)
    if getattr(expires_at, "tzinfo", None) is None:
        expires_at = expires_at.replace(tzinfo=dt.timezone.utc)
    return expires_at <= now


def redeem(
    db: Session,
    *,
    code: str,
    owner_user_id: uuid.UUID,
    event_fields: Dict[str, Any],
    account_id: Optional[uuid.UUID] = None,
    order_id: Optional[str] = None,
) -> Event:
    """Consume an AVAILABLE entitlement and create its one event. Atomic.

    The claim is a single conditional UPDATE: at most one concurrent caller can
    move the row available -> redeemed, so a code is consumed exactly once no
    matter how many requests race. The event is created in the SAME transaction,
    so a failure rolls the claim back and the code stays available.
    """
    claim = db.execute(
        text(
            """
            UPDATE entitlements
            SET status = 'redeemed', redeemed_at = NOW(), redeemed_by_user_id = :uid
            WHERE code = :code
              AND status = 'available'
              AND (expires_at IS NULL OR expires_at > NOW())
            RETURNING id, plan_id, max_guests, campaign_rounds, source
            """
        ),
        {"code": code, "uid": str(owner_user_id)},
    ).mappings().first()

    if claim is None:
        db.rollback()
        raise EntitlementNotRedeemable(_classify_unredeemable(db, code))

    try:
        event = _build_event(
            db, claim=claim, owner_user_id=owner_user_id,
            account_id=account_id, event_fields=event_fields, order_id=order_id,
        )
        db.execute(
            text("UPDATE entitlements SET redeemed_event_id = :eid WHERE id = :id"),
            {"eid": str(event.id), "id": str(claim["id"])},
        )
        db.commit()
    except IntegrityError:
        # A concurrent payment IPN already created the event for this order (the
        # provisioning_order_id UNIQUE index fired). Roll our claim back and let
        # the caller resolve to the winner.
        db.rollback()
        raise
    db.refresh(event)
    logger.info("entitlement %s redeemed -> event %s (plan=%s)",
                claim["id"], event.id, claim["plan_id"])
    return event


def issue_and_redeem(
    db: Session,
    *,
    source: EntitlementSource,
    plan_id: str,
    owner_user_id: uuid.UUID,
    account_id: Optional[uuid.UUID],
    event_fields: Dict[str, Any],
    created_by: Optional[uuid.UUID] = None,
    max_guests: Optional[int] = None,
    campaign_rounds: Optional[int] = None,
    metadata: Optional[dict] = None,
    order_id: Optional[str] = None,
) -> Tuple[Event, bool]:
    """Mint an entitlement and immediately redeem it into an event.

    For the paths where the issuer already holds the event details and hands out
    no link: payment, self-service free creation, clone, admin/venue direct-create.
    Both steps run in one transaction, so the entitlement never lingers AVAILABLE
    and a failure leaves nothing behind.

    Returns `(event, created)`. For payment, `created` is False on a replayed
    order - the idempotency guarantee is preserved by short-circuiting on the
    existing event before any entitlement is minted, and by the
    provisioning_order_id UNIQUE index catching a concurrent race.
    """
    if order_id:
        existing = find_provisioned_event(db, str(order_id))
        if existing is not None:
            logger.info("issue_and_redeem replay for order %s -> event %s", order_id, existing.id)
            return existing, False

    ent = issue(
        db, source=source, plan_id=plan_id, created_by=created_by, account_id=account_id,
        max_guests=max_guests, campaign_rounds=campaign_rounds, metadata=metadata,
        order_id=order_id, commit=False,
    )
    try:
        event = redeem(
            db, code=ent.code, owner_user_id=owner_user_id,
            event_fields=event_fields, account_id=account_id, order_id=order_id,
        )
    except IntegrityError:
        # Concurrent payment race: the other IPN won the provisioning_order_id.
        winner = find_provisioned_event(db, str(order_id)) if order_id else None
        if winner is None:
            raise
        logger.warning("issue_and_redeem race for order %s resolved to event %s", order_id, winner.id)
        return winner, False
    return event, True


# --------------------------------------------------------------------------
# Effective limits - what an event is actually entitled to.
#
# An entitlement may override the plan's defaults (a promo granting Pro rounds
# but a 100-guest cap). The overrides are snapshot onto the event at redemption;
# enforcement reads override-or-default so a NULL override means "use the plan".
# --------------------------------------------------------------------------

def effective_max_guests(event: Event) -> Optional[int]:
    """The event's guest cap: its override, else the plan's cap (None = unlimited).

    May raise PlanLookupUnavailable when falling back to the plan and aub is
    unreachable - capacity enforcement fails closed, same as before.
    """
    override = getattr(event, "max_guests_override", None)
    if override is not None:
        return int(override)
    return plan_count_limit(getattr(event, "plan_id", None))


def effective_included_rounds(event: Event) -> int:
    """The event's included campaign rounds: its override, else the plan's."""
    override = getattr(event, "included_rounds_override", None)
    if override is not None:
        return int(override)
    return included_rounds(getattr(event, "plan_id", None))


def effective_status(ent: Entitlement) -> EntitlementStatus:
    """Display status: an AVAILABLE-but-past-expiry row reads as EXPIRED."""
    status = EntitlementStatus.normalize(ent.status)
    if status == EntitlementStatus.AVAILABLE and _expired(getattr(ent, "expires_at", None)):
        return EntitlementStatus.EXPIRED
    return status


def redemption_link(code: str, public_base: Optional[str] = None) -> str:
    """The shareable redemption URL for a code."""
    import os
    base = (public_base or os.getenv("PUBLIC_BASE_URL") or "").rstrip("/")
    return f"{base}/redeem/{code}"


def to_dict(ent: Entitlement, *, include_code: bool = False, public_base: Optional[str] = None) -> dict:
    """Serialize an entitlement for a dashboard. `include_code` gates the
    redemption credential to authorized issuers (admin / the owning venue)."""
    out = {
        "id": str(ent.id),
        "status": effective_status(ent).value,
        "source": ent.source,
        "plan_id": ent.plan_id,
        "max_guests": ent.max_guests,
        "campaign_rounds": ent.campaign_rounds,
        "expires_at": ent.expires_at.isoformat() if ent.expires_at else None,
        "redeemed_at": ent.redeemed_at.isoformat() if ent.redeemed_at else None,
        "redeemed_by_user_id": str(ent.redeemed_by_user_id) if ent.redeemed_by_user_id else None,
        "redeemed_event_id": str(ent.redeemed_event_id) if ent.redeemed_event_id else None,
        "created_by": str(ent.created_by) if ent.created_by else None,
        "account_id": str(ent.account_id) if ent.account_id else None,
        "created_at": ent.created_at.isoformat() if ent.created_at else None,
        "metadata": ent.entitlement_metadata or {},
    }
    if include_code:
        out["code"] = ent.code
        out["redemption_link"] = redemption_link(ent.code, public_base)
    return out


def set_status(db: Session, ent: Entitlement, target: EntitlementStatus) -> Entitlement:
    """Move an AVAILABLE entitlement to EXPIRED or CANCELLED. Idempotent-safe.

    Only an unredeemed entitlement may be expired or cancelled - a REDEEMED one
    is bound to its event forever and must not be voided out from under it.
    """
    current = EntitlementStatus.normalize(ent.status)
    if current == EntitlementStatus.REDEEMED:
        raise EntitlementError("a redeemed entitlement cannot be changed")
    if target not in (EntitlementStatus.EXPIRED, EntitlementStatus.CANCELLED):
        raise EntitlementError("entitlements can only be expired or cancelled")
    ent.status = target.value
    db.add(ent)
    db.commit()
    db.refresh(ent)
    return ent
