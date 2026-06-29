from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base


Base = declarative_base()


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    guest_id = Column(UUID(as_uuid=True), nullable=True)
    guest_phone = Column(String(64), nullable=False)
    event_id = Column(String(128), nullable=False)  # Changed to String to match WhatsApp message IDs
    current_state = Column(String(128), nullable=False, default="rsvp_invite")
    last_message_id = Column(String(128), nullable=True)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class MessageLog(Base):
    __tablename__ = "messages_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(UUID(as_uuid=True), ForeignKey("conversations.id"), nullable=False)
    guest_phone = Column(String(64), nullable=True)  # Denormalized from conversation for efficient queries
    wa_message_id = Column(String(128), nullable=True)
    direction = Column(String(16), nullable=False)  # incoming | outgoing | status
    message_type = Column(String(32), nullable=False)
    reply_to_id = Column(String(128), nullable=True)
    payload = Column(Text, nullable=True)
    state = Column(String(128), nullable=True)
    status = Column(String(32), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


