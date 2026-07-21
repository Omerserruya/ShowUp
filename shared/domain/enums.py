"""Canonical domain enums - the single source of truth shared across services.

Before V2 these concepts were expressed as ad-hoc magic strings that disagreed
between services (e.g. guest status was 'attending' in the RSVP flow but stats
queried 'confirmed'; 'maybe' was dropped from stats entirely). Every service must
import these instead of hardcoding strings.

Pure stdlib so any service (core-service, webhook-worker, workers) can import it
with no extra dependencies.
"""
from __future__ import annotations

from enum import Enum

# Historic / not-yet-migrated values mapped to canonical ones.
# Removed in Phase 7 once every writer emits canonical values.
_LEGACY_GUEST_STATUS = {
    "attending": "confirmed",
    "pending": "invited",
}


class GuestStatus(str, Enum):
    """Canonical RSVP status of a guest."""
    INVITED = "invited"
    CONFIRMED = "confirmed"
    DECLINED = "declined"
    MAYBE = "maybe"

    @classmethod
    def normalize(cls, value) -> "GuestStatus":
        """Map any legacy/raw value to a canonical GuestStatus (defaults to INVITED)."""
        if isinstance(value, cls):
            return value
        raw = (str(value) if value is not None else "").strip().lower()
        raw = _LEGACY_GUEST_STATUS.get(raw, raw)
        try:
            return cls(raw)
        except ValueError:
            return cls.INVITED

    @classmethod
    def confirmed_values(cls) -> set[str]:
        """All DB string values that mean CONFIRMED (canonical + legacy)."""
        return {cls.CONFIRMED.value, "attending"}

    @classmethod
    def declined_values(cls) -> set[str]:
        return {cls.DECLINED.value}

    @classmethod
    def maybe_values(cls) -> set[str]:
        return {cls.MAYBE.value}

    @classmethod
    def pending_values(cls) -> set[str]:
        """All values that mean 'no decision yet' (canonical + legacy)."""
        return {cls.INVITED.value, "pending"}


class RsvpAction(str, Enum):
    """Semantic meaning of a guest's reply, decoupled from displayed button text.

    Used by the WhatsApp conversation engine (Phase 7) so that any number of
    display labels ('Coming', 'Absolutely', 'See you there') map to one action.
    """
    CONFIRMED = "confirmed"
    DECLINED = "declined"
    MAYBE = "maybe"
    UNKNOWN = "unknown"

    def to_guest_status(self):
        """The GuestStatus implied by this action (None for UNKNOWN)."""
        return {
            RsvpAction.CONFIRMED: GuestStatus.CONFIRMED,
            RsvpAction.DECLINED: GuestStatus.DECLINED,
            RsvpAction.MAYBE: GuestStatus.MAYBE,
        }.get(self)


class EventState(str, Enum):
    """Lifecycle state of an event (Phase 13)."""
    DRAFT = "draft"
    ACTIVE = "active"
    COMPLETED = "completed"
    ARCHIVED = "archived"
    CANCELLED = "cancelled"


class PaymentStatus(str, Enum):
    """Settlement state of an event, orthogonal to its lifecycle `state`.

    An event is *settled* when nothing is owed for it - either a paid plan was
    purchased and verified (PAID) or the plan costs nothing (FREE). Only the
    provisioning path (`core-service/app/provisioning.py`, driven by aub's
    verified-payment flow) may write PAID; no client payload can.

    UNPAID is the legacy/unknown default that predates this enum. It is treated
    as NOT settled, so it can never accidentally grant entitlement; existing rows
    are backfilled to FREE/PAID by `ensure_events_payment_backfill`.
    """
    PAID = "paid"
    FREE = "free"
    PENDING = "pending"
    UNPAID = "unpaid"

    @classmethod
    def normalize(cls, value) -> "PaymentStatus":
        if isinstance(value, cls):
            return value
        try:
            return cls((str(value) if value is not None else "").strip().lower())
        except ValueError:
            return cls.UNPAID

    @classmethod
    def settled_values(cls) -> set[str]:
        """DB string values that mean 'nothing owed'. Use in raw-SQL filters."""
        return {cls.PAID.value, cls.FREE.value}


def is_settled(payment_status) -> bool:
    """True when nothing is owed for the event (paid plan verified, or free)."""
    return PaymentStatus.normalize(payment_status) in (PaymentStatus.PAID, PaymentStatus.FREE)


class EntitlementStatus(str, Enum):
    """Lifecycle of an event Entitlement - the right to create one event.

    AVAILABLE  issued, not yet used. The only status a redemption can consume.
    REDEEMED   consumed by exactly one event (terminal). `redeemed_event_id`
               and `redeemed_by_user_id` record which and by whom.
    EXPIRED    passed `expires_at` without being redeemed (terminal).
    CANCELLED  revoked before redemption (terminal).

    Only AVAILABLE is redeemable, and a past `expires_at` is treated as
    unavailable even before a sweep flips the row - see `effective_status`.
    """
    AVAILABLE = "available"
    REDEEMED = "redeemed"
    EXPIRED = "expired"
    CANCELLED = "cancelled"

    @classmethod
    def normalize(cls, value) -> "EntitlementStatus":
        if isinstance(value, cls):
            return value
        try:
            return cls((str(value) if value is not None else "").strip().lower())
        except ValueError:
            return cls.CANCELLED  # unknown => not redeemable, fail closed


class EntitlementSource(str, Enum):
    """WHO issued an entitlement - the reason a user may create an event.

    This is the extensibility seam the whole design turns on: a new business
    model (affiliate, reseller, loyalty, ...) is a new source value plus an
    issuer that mints entitlements, with NO change to event creation or
    enforcement. Payment is deliberately just one member of this set.

    SYSTEM is the auto-issued free/starter grant for self-service creation and
    clones - it keeps the invariant "every event consumes an entitlement" true
    without putting a redemption link in front of a user making a free event.
    """
    PAYMENT = "payment"
    VENUE = "venue"
    BETA = "beta"
    ADMIN = "admin"
    PROMOTION = "promotion"
    PARTNER = "partner"
    SYSTEM = "system"

    @classmethod
    def normalize(cls, value) -> "EntitlementSource":
        if isinstance(value, cls):
            return value
        try:
            return cls((str(value) if value is not None else "").strip().lower())
        except ValueError:
            raise ValueError(f"unknown entitlement source: {value!r}")


class CampaignAudience(str, Enum):
    """Who a campaign/round targets (Phase 6). Decoupled from template choice."""
    EVERYONE = "everyone"
    CONFIRMED = "confirmed"
    DECLINED = "declined"
    NO_RESPONSE = "no_response"
    CUSTOM = "custom"


class FieldType(str, Enum):
    """Data type of an event-defined custom field (Phase 4)."""
    TEXT = "text"
    NUMBER = "number"
    BOOLEAN = "boolean"
    ENUM = "enum"
    DATE = "date"


class TemplateState(str, Enum):
    """WhatsApp template lifecycle (Phase 8). Only APPROVED/ACTIVE are usable."""
    DRAFT = "draft"
    VALIDATED = "validated"
    META_PENDING = "meta_pending"
    APPROVED = "approved"
    ACTIVE = "active"
    ARCHIVED = "archived"
    DELETED = "deleted"


class GuestEventType(str, Enum):
    """Guest timeline activity types (Phase 9)."""
    MESSAGE_SENT = "message_sent"
    MESSAGE_DELIVERED = "message_delivered"
    MESSAGE_READ = "message_read"
    CONFIRMED = "confirmed"
    DECLINED = "declined"
    MAYBE = "maybe"
    COUNT_UPDATED = "count_updated"
    MANUAL_OVERRIDE = "manual_override"
    STAFF_EDIT = "staff_edit"
    AI_ACTION = "ai_action"
    TAGGED = "tagged"
    IMPORTED = "imported"


class ActorType(str, Enum):
    """Who performed an action (timeline + audit)."""
    USER = "user"
    GUEST = "guest"
    SYSTEM = "system"
    ASSISTANT = "assistant"


class UsageMetric(str, Enum):
    """Internally-metered billing dimensions (Phase 10).

    Guests and rounds are customer-facing limits; messages are metered internally
    for cost analysis only and are NOT exposed as a customer quota.
    """
    GUEST_ADDED = "guest_added"
    ROUND_LAUNCHED = "round_launched"
    MESSAGE_SENT = "message_sent"

