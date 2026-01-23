from __future__ import annotations

import datetime as dt
import uuid
from typing import List, Optional

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text, func, JSON, Boolean
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
    channel = Column(String(20), nullable=False)
    schedule_time = Column(DateTime(timezone=True), nullable=True)
    status = Column(String(20), nullable=False, default="pending")
    # Number of recipients the campaign was actually sent to (messages enqueued)
    recipient_count = Column(Integer, nullable=False, default=0, server_default="0")

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


