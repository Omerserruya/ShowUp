from __future__ import annotations

import datetime as dt
import uuid
from typing import List, Optional

from pydantic import BaseModel, Field, EmailStr, field_validator


class Pagination(BaseModel):
    page: int = Field(1, ge=1)
    page_size: int = Field(20, ge=1, le=200)


# Inviter Schema
class Inviter(BaseModel):
    fn: str = Field(..., description="First name")
    ln: str = Field(..., description="Last name")


# Event Schemas
class EventBase(BaseModel):
    owners: List[uuid.UUID] = Field(default_factory=list)
    inviters: List[Inviter] = Field(default_factory=list)
    name: str = Field(..., max_length=100)
    description: Optional[str] = None
    event_date: Optional[dt.datetime] = None
    location: Optional[str] = Field(default=None, max_length=200)
    active: bool = True


class EventCreate(EventBase):
    # Owners should not be sent by clients; will be set to [current_user_id]
    owners: Optional[List[uuid.UUID]] = None


class EventUpdate(BaseModel):
    owners: Optional[List[uuid.UUID]] = None
    inviters: Optional[List[Inviter]] = None
    name: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = None
    event_date: Optional[dt.datetime] = None
    location: Optional[str] = Field(default=None, max_length=200)


class EventOut(EventBase):
    id: uuid.UUID
    created_at: dt.datetime
    updated_at: dt.datetime

    @field_validator('inviters', mode='before')
    @classmethod
    def validate_inviters(cls, v):
        # Convert list of dicts (from JSON) to list of Inviter objects
        if v is None:
            return []
        if isinstance(v, list):
            return [Inviter(**item) if isinstance(item, dict) else item for item in v]
        return v

    class Config:
        from_attributes = True


# Guest Schemas
class GuestBase(BaseModel):
    event_id: uuid.UUID
    name: str = Field(..., max_length=100)
    phone: str = Field(..., max_length=20)
    email: Optional[EmailStr] = None
    status: str = Field("invited", max_length=20)
    group: Optional[str] = Field(default=None, max_length=100, description="Guest group/side (e.g. bride, groom)")
    import_count: int = Field(1, ge=1)
    guest_count: Optional[int] = Field(default=None, ge=1)
    table_number: Optional[int] = Field(default=None, ge=1, le=128)
    notes: Optional[str] = None
    last_response: Optional[dt.datetime] = None


class GuestCreate(GuestBase):
    pass


class GuestUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    phone: Optional[str] = Field(default=None, max_length=20)
    email: Optional[EmailStr] = None
    status: Optional[str] = Field(default=None, max_length=20)
    group: Optional[str] = Field(default=None, max_length=100, description="Guest group/side (e.g. bride, groom)")
    import_count: Optional[int] = Field(default=None, ge=1)
    guest_count: Optional[int] = Field(default=None, ge=1)
    table_number: Optional[int] = Field(default=None, ge=1, le=128)
    notes: Optional[str] = None
    last_response: Optional[dt.datetime] = None


class GuestOut(GuestBase):
    id: uuid.UUID
    created_at: dt.datetime

    class Config:
        from_attributes = True


# Campaign Schemas
class CampaignBase(BaseModel):
    event_id: uuid.UUID
    name: str = Field(..., max_length=100)
    template: str
    channel: str = Field(..., max_length=20)
    schedule_time: Optional[dt.datetime] = None
    status: str = Field("pending", max_length=20)


class CampaignCreate(CampaignBase):
    pass


class CampaignUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    template: Optional[str] = None
    channel: Optional[str] = Field(default=None, max_length=20)
    schedule_time: Optional[dt.datetime] = None
    status: Optional[str] = Field(default=None, max_length=20)


class CampaignOut(CampaignBase):
    id: uuid.UUID
    created_at: dt.datetime
    updated_at: dt.datetime

    class Config:
        from_attributes = True


class PaginatedResponse(BaseModel):
    total: int
    page: int
    page_size: int
    items: list


