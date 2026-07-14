from __future__ import annotations

import datetime as dt
import uuid
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, EmailStr, field_validator

from shared.domain.enums import CampaignAudience


class Pagination(BaseModel):
    page: int = Field(1, ge=1)
    page_size: int = Field(20, ge=1, le=200)


# Inviter Schema
class Inviter(BaseModel):
    fn: str = Field(..., description="First name")
    ln: str = Field(..., description="Last name")


# ---- Public web invitation (Phase 16) ----
class InvitationEnvelope(BaseModel):
    enabled: bool = False                # show the wax-sealed envelope intro
    color: str = "#f5efe6"               # envelope paper colour
    texture: Optional[str] = None        # texture key (e.g. "linen") or image url
    waxColor: Optional[str] = None       # wax seal colour
    stampText: Optional[str] = None      # text pressed into the wax seal
    paperText: Optional[str] = None      # message written on the envelope paper
    envelopeText: Optional[str] = None   # editorial overline (shown on the photo)
    font: Optional[str] = None


class InvitationHero(BaseModel):
    imageUrl: Optional[str] = None
    bigText: Optional[str] = None        # large headline below the photo
    font: Optional[str] = None


class InvitationDetails(BaseModel):
    showDate: bool = True
    showTime: bool = True
    showLocation: bool = True


class InvitationConfig(BaseModel):
    """Design config for the public web invitation. Persisted as Event.invitation."""
    envelope: InvitationEnvelope = Field(default_factory=InvitationEnvelope)
    hero: InvitationHero = Field(default_factory=InvitationHero)
    personalText: Optional[str] = None
    details: InvitationDetails = Field(default_factory=InvitationDetails)
    fontFamily: Optional[str] = None
    rsvpEnabled: bool = True
    # Section-based studio model (Framer-style composable invitation). Optional and
    # free-form so the editor can evolve sections/theme without backend changes.
    # Legacy fields above are kept in sync for backward compatibility.
    theme: Optional[Dict[str, Any]] = None
    sections: Optional[List[Dict[str, Any]]] = None
    labels: Optional[Dict[str, str]] = None  # editable UI labels keyed by id
    order: Optional[List[str]] = None        # order of the movable content blocks
    hidden: Optional[List[str]] = None       # ids of content blocks hidden from guests

    class Config:
        populate_by_name = True


class PublicRsvpIn(BaseModel):
    """Open-form RSVP submitted from the public invitation page (no auth)."""
    name: str = Field(..., min_length=1, max_length=100)
    phone: str = Field(..., min_length=5, max_length=20)
    party_size: int = Field(1, ge=1, le=50, validation_alias="partySize", serialization_alias="partySize")
    status: str = Field("confirmed", max_length=20)  # confirmed | declined | maybe
    notes: Optional[str] = Field(default=None, max_length=500)

    class Config:
        populate_by_name = True


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
    # Event type (wedding, brit, ...) - drives adaptive timeline + template recommendations.
    event_type: Optional[str] = Field(None, serialization_alias="eventType", validation_alias="eventType")
    # Event-type-specific subjects (bride/groom/parents/baby/celebrant/company).
    subjects: Optional[dict] = None
    # Payment dimension (paid | free | pending | unpaid), independent of `state`.
    payment_status: Optional[str] = Field(None, serialization_alias="paymentStatus", validation_alias="paymentStatus")
    plan_id: Optional[str] = Field(None, serialization_alias="planId")  # Plan ID from MongoDB (serialized as planId)
    seating_layout: Optional[dict] = Field(None, serialization_alias="seatingLayout", validation_alias="seatingLayout")  # { tables: [...] }
    public_slug: Optional[str] = Field(None, serialization_alias="publicSlug", validation_alias="publicSlug")
    invitation: Optional[dict] = None  # InvitationConfig design (see schemas.InvitationConfig)
    invitation_published: Optional[bool] = Field(False, serialization_alias="invitationPublished", validation_alias="invitationPublished")

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
    seating_layout: Optional[dict] = Field(None, serialization_alias="seatingLayout", validation_alias="seatingLayout")


class EventOut(EventBase):
    id: uuid.UUID
    state: Optional[str] = None
    created_at: dt.datetime
    updated_at: dt.datetime
    # Venue Edition identity (derived, not a column): when the event belongs to a
    # partner venue Account, surface its name so the UI can show "Provided by
    # <Venue>" and detect the venue-sourced upgrade/partner-discount flow. Populated
    # by event_crud.annotate_venue on the read paths; defaults keep other paths safe.
    venue_name: Optional[str] = Field(None, serialization_alias="venueName", validation_alias="venueName")
    is_venue: Optional[bool] = Field(None, serialization_alias="isVenue", validation_alias="isVenue")

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
    # Optional user-written body that overrides the template at send time.
    custom_message: Optional[str] = None
    channel: str = Field(..., max_length=20)
    schedule_time: Optional[dt.datetime] = None
    status: str = Field("pending", max_length=20)
    # Number of recipients the campaign was actually sent to (messages enqueued)
    recipient_count: int = Field(0, ge=0)
    # Optional header image (S3 object URL) for image-header templates.
    header_image_url: Optional[str] = None
    # Phase 6: first-class audience + optional single follow-up.
    audience: CampaignAudience = CampaignAudience.EVERYONE
    audience_filter: Optional[dict] = None
    follow_up_after_hours: Optional[int] = Field(default=None, ge=1)
    follow_up_audience: Optional[CampaignAudience] = None


class CampaignCreate(CampaignBase):
    pass


class CampaignUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    template: Optional[str] = None
    channel: Optional[str] = Field(default=None, max_length=20)
    schedule_time: Optional[dt.datetime] = None
    status: Optional[str] = Field(default=None, max_length=20)
    audience: Optional[CampaignAudience] = None
    audience_filter: Optional[dict] = None
    follow_up_after_hours: Optional[int] = Field(default=None, ge=1)
    follow_up_audience: Optional[CampaignAudience] = None
    header_image_url: Optional[str] = None


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
    maybe: int = 0  # guests who replied "maybe" (previously omitted from stats)


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


