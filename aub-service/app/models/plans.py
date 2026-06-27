"""
Pydantic models for the plans API (backed by app/data/plans.json — no database).
"""
from typing import List, Optional
from pydantic import BaseModel, Field, field_validator


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


class PlanResponse(BaseModel):
    """Plan API response model"""
    id: str
    title: str
    subtitle: str
    price: str
    description: str
    features: List[str]
    color: str
    # Frontend expects camelCase `isPopular`; mapped from `is_popular` in the router.
    isPopular: bool = False
    campaigns: List[CampaignSchedule] = []
    countLimit: Optional[int] = None  # Maximum number of guests allowed

    class Config:
        populate_by_name = True
