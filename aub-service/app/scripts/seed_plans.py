"""
Seed script to populate initial plans in MongoDB
Run this script to initialize plans collection with default data
"""
import sys
import os
from pathlib import Path

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from mongodb import get_mongodb_db
from datetime import datetime


def seed_plans():
    """Seed initial plans data"""
    db = get_mongodb_db()
    plans_collection = db.plans
    
    # Default plans data
    plans_data = [
        {
            "id": "basic",
            "title": "Basic",
            "subtitle": "בוא נתחיל",
            "price": "₪39",
            "description": "עד 50 אורחים",
            "features": [
                "שליחת הודעות בסיסיות בוואטסאפ",
                "מעקב תגובות בסיסי",
                "דשבורד תגובות",
            ],
            "color": "#4CAF50",
            "is_popular": False,
            "is_active": True,
            "campaigns": [
                {"enabled": True, "label": "RSVP", "offset_days": 7, "time": "12:00"},
                {"enabled": True, "label": "rsvp_reminder", "offset_days": 1, "time": "18:00"},
            ],
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        },
        {
            "id": "plus",
            "title": "Plus",
            "subtitle": "אירוע בשליטה",
            "price": "₪99",
            "description": "עד 250 אורחים",
            "features": [
                "תזמון הודעות מתקדם",
                "תגובות מסווגות לפי תוכן",
                "ייבוא אנשי קשר מכל פורמט",
                "תמיכה בצ'אט",
            ],
            "color": "#2196F3",
            "is_popular": True,
            "is_active": True,
            "campaigns": [
                {"enabled": True, "label": "RSVP", "offset_days": 30, "time": "10:00"},
                {"enabled": True, "label": "nudge_reminder", "offset_days": 7, "time": "12:00"},
                {"enabled": True, "label": "event_remind", "offset_days": 1, "time": "18:00"},
                {"enabled": True, "label": "thank_you", "offset_days": -1, "time": "11:00"},
            ],
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        },
        {
            "id": "pro",
            "title": "Pro",
            "subtitle": "הכול כלול",
            "price": "₪199",
            "description": "ללא הגבלת אורחים",
            "features": [
                "אוטומציות ותזכורות מתקדמות",
                "אינטגרציות עם Google Sheets / CRM",
                "ניתוחי בינה מלאכותית לתגובות",
                "תיוגים והערות על אורחים",
                "תמיכה טלפונית",
            ],
            "color": "#9C27B0",
            "is_popular": False,
            "is_active": True,
            "campaigns": [
                {"enabled": True, "label": "RSVP", "offset_days": 30, "time": "10:00"},
                {"enabled": True, "label": "nudge_reminder", "offset_days": 7, "time": "12:00"},
                {"enabled": True, "label": "event_remind", "offset_days": 1, "time": "18:00"},
                {"enabled": True, "label": "thank_you", "offset_days": -1, "time": "11:00"},
            ],
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        },
    ]
    
    # Upsert plans (update if exists, insert if not)
    for plan_data in plans_data:
        plan_id = plan_data["id"]
        result = plans_collection.update_one(
            {"id": plan_id},
            {"$set": plan_data},
            upsert=True
        )
        print(f"Upserted plan '{plan_id}': {result.upserted_id or 'updated'}")
    
    print(f"\n✅ Successfully seeded {len(plans_data)} plans")
    print("Plans are now available via GET /plans endpoint")


if __name__ == "__main__":
    try:
        seed_plans()
    except Exception as e:
        print(f"❌ Error seeding plans: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
