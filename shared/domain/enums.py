"""Canonical domain enums — the single source of truth shared across services.

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

