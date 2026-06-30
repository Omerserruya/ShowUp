from __future__ import annotations

import datetime as dt
import uuid
from typing import List, Optional

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func, JSON, Boolean, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import relationship, Mapped, mapped_column

from app.db import Base


def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class Event(Base):
    __tablename__ = "events"

    # Use native UUID if available (Postgres), otherwise fallback to CHAR(36)
    try:
        id: Mapped[uuid.UUID] = mapped_column(
            PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
        )
    except Exception:  # pragma: no cover - when not on PG
        id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # Owners as JSON array of UUID strings for portability across DBs
    owners = Column(JSON, nullable=False, default=list, server_default='[]')

    # Inviters as JSON array of objects with fn and ln fields
    inviters = Column(JSON, nullable=False, default=list, server_default='[]')

    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    event_date = Column(DateTime(timezone=True), nullable=True)
    # Store location as free-form text (can hold JSON string)
    location = Column(Text, nullable=True)
    active = Column(Boolean, nullable=False, server_default='true')
    # V2 lifecycle (Phase 13): see shared.domain.enums.EventState. Kept in sync
    # with the legacy `active` boolean (active for draft/active states).
    state = Column(String(20), nullable=False, server_default='active')
    # Payment dimension, independent of the lifecycle `state`. One of
    # 'paid' (a paid plan was purchased), 'free' (free plan, nothing owed),
    # 'pending' (awaiting payment), 'unpaid' (legacy/unknown). Set to 'paid' by
    # the aub-service provisioning path and 'free' on free-plan creation.
    payment_status = Column(String(20), nullable=False, server_default='unpaid')
    # V2 tenancy: nullable during migration; new events are bound to an account.
    # Legacy events keep ownership via the `owners` JSON array until backfilled.
    account_id = Column(PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True)
    plan_id = Column(String(50), nullable=True)  # Plan ID from MongoDB (e.g., "basic", "plus", "pro")
    # Event type (wedding, brit, brita, bar, bat, corporate, birthday, other). Drives
    # the adaptive timeline + which templates are recommended. Loosely typed string.
    event_type = Column(String(50), nullable=True)
    # Seating map: { "tables": [ { "id", "name", "seats", "style", "side", "position", "size", "seatsBride?", "seatsGroom?" }, ... ] }
    seating_layout = Column(JSON, nullable=True)

    # Public web invitation (Phase 16). slug is the shareable handle in the URL
    # (/i/{slug}); invitation holds the design config (envelope, hero, personal
    # text, detail toggles) - see schemas.InvitationConfig. published gates whether
    # the public page + open-form RSVP are live.
    public_slug = Column(String(120), nullable=True, unique=True, index=True)
    invitation = Column(JSON, nullable=True)
    invitation_published = Column(Boolean, nullable=False, server_default='false')

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    guests: Mapped[List["Guest"]] = relationship("Guest", back_populates="event", cascade="all, delete-orphan")
    campaigns: Mapped[List["Campaign"]] = relationship("Campaign", back_populates="event", cascade="all, delete-orphan")


class Guest(Base):
    __tablename__ = "guests"

    try:
        id: Mapped[uuid.UUID] = mapped_column(
            PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
        )
        event_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    except Exception:  # pragma: no cover
        id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
        event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False)

    name = Column(String(100), nullable=False)
    # group / side of guest (e.g. bride, groom, family, friends)
    # Use DB column name 'guest_group' to avoid reserved-word issues with 'group'
    group = Column("guest_group", String(100), nullable=True)
    phone = Column(String(20), nullable=False, index=True)
    email = Column(String(100), nullable=True)
    status = Column(String(20), nullable=False, default="invited")
    # import_count = expected number from event owner (default 1)
    import_count = Column(Integer, nullable=False, default=1, server_default="1")
    # guest_count = number provided by guest via WhatsApp (NULL until answered)
    guest_count = Column(Integer, nullable=True, default=None)
    table_number = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    last_response = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    event: Mapped[Event] = relationship("Event", back_populates="guests")


class Campaign(Base):
    __tablename__ = "campaigns"

    try:
        id: Mapped[uuid.UUID] = mapped_column(
            PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
        )
        event_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    except Exception:  # pragma: no cover
        id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
        event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False)

    name = Column(String(100), nullable=False)
    template = Column(Text, nullable=False)
    # Optional user-written body that overrides the template at send time (once an
    # approved WhatsApp template backs it). Captured in the wizard; persisted here
    # so the custom copy is never lost between order provisioning and sending.
    custom_message = Column(Text, nullable=True)
    channel = Column(String(20), nullable=False)
    schedule_time = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(20), nullable=False, default="pending")
    # Number of recipients the campaign was actually sent to (messages enqueued)
    recipient_count = Column(Integer, nullable=False, default=0, server_default="0")

    # V2 (Phase 6): audience is first-class and decoupled from the template.
    audience = Column(String(20), nullable=False, server_default="everyone")  # see CampaignAudience
    audience_filter = Column(JSON, nullable=True)  # structured filter when audience == 'custom'
    # Optional single follow-up (NOT a sequence engine): after N hours, re-send to
    # the follow_up_audience (typically 'no_response').
    follow_up_after_hours = Column(Integer, nullable=True)
    follow_up_audience = Column(String(20), nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    event: Mapped[Event] = relationship("Event", back_populates="campaigns")


class GuestImport(Base):
    __tablename__ = "guest_imports"

    try:
        id: Mapped[uuid.UUID] = mapped_column(
            PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
        )
        event_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    except Exception:  # pragma: no cover
        id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
        event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False)

    source = Column(String(50), nullable=False, default="whatsapp")  # e.g., "whatsapp", "csv", "manual"
    raw_payload = Column(Text, nullable=False)  # Full message as JSON
    status = Column(String(20), nullable=False, default="pending")  # pending, processing, completed, failed
    message_id = Column(String(128), nullable=True, unique=True)  # WhatsApp message ID for idempotency
    
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    contacts: Mapped[List["GuestImportContact"]] = relationship("GuestImportContact", back_populates="import_record", cascade="all, delete-orphan")


class GuestImportContact(Base):
    __tablename__ = "guest_import_contacts"

    try:
        id: Mapped[uuid.UUID] = mapped_column(
            PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
        )
        import_id: Mapped[uuid.UUID] = mapped_column(PG_UUID(as_uuid=True), ForeignKey("guest_imports.id", ondelete="CASCADE"), nullable=False)
    except Exception:  # pragma: no cover
        id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
        import_id = Column(String(36), ForeignKey("guest_imports.id", ondelete="CASCADE"), nullable=False)

    name = Column(String(200), nullable=True)  # Contact name (formatted_name from WhatsApp)
    phone = Column(String(20), nullable=True)  # Primary phone number
    email = Column(String(100), nullable=True)  # Primary email if exists
    status = Column(String(20), nullable=False, default="pending")  # pending, validated, imported, failed
    validation_errors = Column(Text, nullable=True)  # JSON array of validation errors
    
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    import_record: Mapped["GuestImport"] = relationship("GuestImport", back_populates="contacts")


class Account(Base):
    """V2 tenant root. An account owns events and has members (memberships)."""
    __tablename__ = "accounts"

    id = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(200), nullable=True)
    billing_email = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class Membership(Base):
    """A user's role within an account (the RBAC link). Flat per-account role."""
    __tablename__ = "memberships"

    id = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id = mapped_column(PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    role = Column(String(30), nullable=False)            # see shared.domain.roles.Role
    status = Column(String(20), nullable=False, server_default="active")  # active|invited|suspended
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("account_id", "user_id", name="uq_membership_account_user"),
    )


class EventFieldDef(Base):
    """Per-event custom field definition (Phase 4). Replaces hardcoded attributes."""
    __tablename__ = "event_field_defs"

    id = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id = mapped_column(PG_UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    key = Column(String(50), nullable=False)            # stable machine key
    label = Column(String(100), nullable=False)         # display
    data_type = Column(String(20), nullable=False)      # see shared.domain.enums.FieldType
    options = Column(JSON, nullable=True)               # allowed values for ENUM
    required = Column(Boolean, nullable=False, server_default='false')
    applies_to_template = Column(Boolean, nullable=False, server_default='false')
    sort_order = Column(Integer, nullable=False, server_default='0')
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("event_id", "key", name="uq_field_event_key"),
    )


class GuestCustomValue(Base):
    """A guest's value for an event-defined custom field (Phase 4)."""
    __tablename__ = "guest_custom_values"

    id = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    guest_id = mapped_column(PG_UUID(as_uuid=True), ForeignKey("guests.id", ondelete="CASCADE"), nullable=False, index=True)
    field_def_id = mapped_column(PG_UUID(as_uuid=True), ForeignKey("event_field_defs.id", ondelete="CASCADE"), nullable=False)
    value = Column(JSON, nullable=True)

    __table_args__ = (
        UniqueConstraint("guest_id", "field_def_id", name="uq_value_guest_field"),
    )


class Tag(Base):
    """Reusable, account-scoped tag (Phase 5). Independent of guest_group."""
    __tablename__ = "tags"

    id = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id = mapped_column(PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(50), nullable=False)
    color = Column(String(20), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("account_id", "name", name="uq_tag_account_name"),
    )


class GuestTag(Base):
    """Many-to-many guest<->tag link (Phase 5)."""
    __tablename__ = "guest_tags"

    guest_id = mapped_column(PG_UUID(as_uuid=True), ForeignKey("guests.id", ondelete="CASCADE"), primary_key=True)
    tag_id = mapped_column(PG_UUID(as_uuid=True), ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)


class AssistantIdentityLink(Base):
    """Binds a WhatsApp phone to a verified user for the AI assistant (Phase 12).

    The assistant NEVER trusts the inbound sender phone alone - only a row with
    verified=True (established via an explicit OTP/deep-link step) authenticates.
    """
    __tablename__ = "assistant_identity_links"

    id = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    phone = Column(String(20), nullable=False, unique=True)
    user_id = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    verified = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    verified_at = Column(DateTime(timezone=True), nullable=True)


class AssistantSession(Base):
    """A scoped assistant conversation session (Phase 12)."""
    __tablename__ = "assistant_sessions"

    id = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    account_id = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    event_id = mapped_column(PG_UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    channel = Column(String(30), nullable=False, server_default="whatsapp_assistant")
    active = Column(Boolean, nullable=False, server_default="true")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    expires_at = Column(DateTime(timezone=True), nullable=True)


class AuditLog(Base):
    """Cross-cutting append-only audit trail (Phase 11). Who did what, when."""
    __tablename__ = "audit_log"

    id = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id = mapped_column(PG_UUID(as_uuid=True), nullable=True, index=True)
    actor_type = Column(String(20), nullable=False)    # see ActorType
    actor_id = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    action = Column(String(60), nullable=False)
    entity_type = Column(String(40), nullable=True)
    entity_id = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    data = Column(JSON, nullable=True)
    occurred_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class UsageEvent(Base):
    """Append-only usage ledger for billing/metering (Phase 10)."""
    __tablename__ = "usage_events"

    id = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id = mapped_column(PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True)
    event_id = mapped_column(PG_UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=True, index=True)
    metric = Column(String(30), nullable=False)        # see UsageMetric
    quantity = Column(Integer, nullable=False, server_default="1")
    ref_id = Column(PG_UUID(as_uuid=True), nullable=True)
    occurred_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class GuestActivity(Base):
    """Append-only guest timeline entry (Phase 9). One extensible activity model."""
    __tablename__ = "guest_events"

    id = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    guest_id = mapped_column(PG_UUID(as_uuid=True), ForeignKey("guests.id", ondelete="CASCADE"), nullable=False, index=True)
    event_id = mapped_column(PG_UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(30), nullable=False)           # see GuestEventType
    actor_type = Column(String(20), nullable=False)     # see ActorType
    actor_id = Column(PG_UUID(as_uuid=True), nullable=True)
    data = Column(JSON, nullable=True)
    occurred_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class WaTemplate(Base):
    """WhatsApp message template with lifecycle (Phase 8).

    event_id NULL = global/account template; event_id set = event-specific.
    lifecycle: see shared.domain.enums.TemplateState. Only approved/active usable.
    """
    __tablename__ = "wa_templates"

    id = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id = mapped_column(PG_UUID(as_uuid=True), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, index=True)
    event_id = mapped_column(PG_UUID(as_uuid=True), ForeignKey("events.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(100), nullable=False)
    language = Column(String(10), nullable=False, server_default="he")
    category = Column(String(30), nullable=True)
    body = Column(Text, nullable=False)
    allowed_vars = Column(JSON, nullable=True)        # vars detected at validation time
    components = Column(JSON, nullable=True)           # header/body/buttons structure (+ title)
    lifecycle = Column(String(20), nullable=False, server_default="draft")
    meta_template_id = Column(String(128), nullable=True)
    rejection_reason = Column(Text, nullable=True)
    # --- Scalable metadata (Phase 17): metadata-driven template selection. ---
    # flow_stage: invitation | reminder | final_reminder | thank_you (the campaign
    #   stage this template serves). visibility: 'public' (everyone) | 'private'
    #   (event-scoped; event_id is set). event_type: which event type it fits
    #   (NULL/empty = all). expires_at: private templates may auto-expire after the
    #   event so they can be cleaned up. created_by: the user who authored it.
    flow_stage = Column(String(30), nullable=True, index=True)
    visibility = Column(String(10), nullable=False, server_default="public")
    event_type = Column(String(50), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(PG_UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


