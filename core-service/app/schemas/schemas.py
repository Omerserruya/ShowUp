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
    # Stored as free-form text (often JSON string from places autocomplete)
    location: Optional[str] = None
    active: bool = True
    plan_id: Optional[str] = Field(None, serialization_alias="planId")  # Plan ID from MongoDB (serialized as planId)
    
    class Config:
        populate_by_name = True  # Allow both plan_id and planId when parsing


class EventCreate(EventBase):
    # Owners should not be sent by clients; will be set to [current_user_id]
    owners: Optional[List[uuid.UUID]] = None


class EventUpdate(BaseModel):
    owners: Optional[List[uuid.UUID]] = None
    inviters: Optional[List[Inviter]] = None
    name: Optional[str] = Field(default=None, max_length=100)
    description: Optional[str] = None
    event_date: Optional[dt.datetime] = None
    location: Optional[str] = None
    plan_id: Optional[str] = None


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

    def model_dump(self, **kwargs):
        """Override to serialize plan_id as planId for frontend compatibility"""
        # Always use by_alias=True to convert plan_id to planId
        data = super().model_dump(by_alias=True, **kwargs)
        return data

    class Config:
        from_attributes = True
        populate_by_name = True  # Allow both plan_id and planId when parsing


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
    # Number of recipients the campaign was actually sent to (messages enqueued)
    recipient_count: int = Field(0, ge=0)


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
    items: List[GuestOut]


# Guest Stats Schemas
class GuestStatsOut(BaseModel):
    total: int  # Sum of import_count (total people invited)
    total_guests: int  # Count of guest records (number of invitations)
    confirmed: int
    declined: int
    pending: int


class DailyResponseData(BaseModel):
    date: str
    dateLabel: str
    confirmed: int
    declined: int


class MilestoneData(BaseModel):
    date: str
    dateLabel: str
    label: str


class DailyResponsesOut(BaseModel):
    data: List[DailyResponseData]
    milestones: List[MilestoneData]


