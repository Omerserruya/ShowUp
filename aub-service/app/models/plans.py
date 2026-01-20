"""
MongoDB models for plans
"""
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, Field
from bson import ObjectId
from pydantic import field_validator


class CampaignSchedule(BaseModel):
    """Campaign schedule configuration"""
    enabled: bool
    label: str
    offsetDays: int
    time: str
    
    @field_validator('offsetDays', mode='before')
    @classmethod
    def normalize_offset_days(cls, v):
        """Handle both offset_days and offsetDays"""
        return v
    
    class Config:
        populate_by_name = True
        allow_population_by_field_name = True
        
    def __init__(self, **data):
        # Normalize offset_days to offsetDays for backward compatibility
        if 'offset_days' in data and 'offsetDays' not in data:
            data['offsetDays'] = data.pop('offset_days')
        elif 'offsetDays' not in data:
            data['offsetDays'] = data.get('offsetDays', 0)
        super().__init__(**data)


class Plan(BaseModel):
    """Plan document model"""
    id: str = Field(..., alias="_id")
    title: str
    subtitle: str
    price: str
    description: str
    features: List[str]
    color: str
    is_popular: bool = False
    campaigns: List[CampaignSchedule] = []
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
        json_encoders = {
            ObjectId: str,
            datetime: lambda v: v.isoformat()
        }


class PlanResponse(BaseModel):
    """Plan API response model"""
    id: str
    title: str
    subtitle: str
    price: str
    description: str
    features: List[str]
    color: str
    # Frontend expects camelCase `isPopular`
    # We map from Mongo's `is_popular` field in the router layer
    isPopular: bool = False
    campaigns: List[CampaignSchedule] = []

    class Config:
        populate_by_name = True
