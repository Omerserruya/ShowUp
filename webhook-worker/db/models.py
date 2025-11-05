from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, relationship


Base = declarative_base()


class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(UUID(as_uuid=True), primary_key=True)
    guest_id = Column(UUID(as_uuid=True), nullable=True)
    guest_phone = Column(String(64), nullable=False)
    event_id = Column(UUID(as_uuid=True), nullable=False)
    current_state = Column(String(128), nullable=False, default="rsvp_invite")
    last_message_id = Column(String(128), nullable=True)
    active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class MessageLog(Base):
    __tablename__ = "messages_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(UUID(as_uuid=True), nullable=True)
    wa_message_id = Column(String(128), nullable=True)
    direction = Column(String(16), nullable=False)  # incoming | outgoing
    message_type = Column(String(32), nullable=False)
    reply_to_id = Column(String(128), nullable=True)
    payload = Column(Text, nullable=True)
    state = Column(String(128), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


