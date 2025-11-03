import requests
import random
import string
from datetime import datetime, timedelta, timezone

BASE_URL = "https://dev.28042000.xyz/api"
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMDc3MDgwNmUtMzA4Yy00MmRmLWFlMGYtOGE4MTM2YTNmNjI5Iiwic3ViIjoiMTIzNDU2Nzg5IiwiaWF0IjoxNzYyMTc5ODA0LCJleHAiOjE3NjIxODM0MDR9.UCanw_sd2qyYFr-QEAmIF2ikuGlRlY8t8_kr-hAio-U"

def create_event(headers):
    payload = {
        "name": "Tested Event",
        "description": "Optional text",
        "event_date": "2025-12-31T18:00:00Z",
        "location": "Optional location"
    }
    resp = requests.post(f"{BASE_URL}/events", json=payload, headers=headers)
    resp.raise_for_status()
    data = resp.json()
    print("Event created:", data["id"])
    return data["id"]

def create_guests(event_id, headers):
    items = []
    items.append({
        "name": "עומר צרויה",
        "phone": "+972525401686",
        "guest_count": 1
    })

    payload = {"items": items}
    resp = requests.post(f"{BASE_URL}/guests?event_id={event_id}", json=payload, headers=headers)
    resp.raise_for_status()
    print("Guests uploaded:", len(items))

from datetime import datetime, timedelta, timezone

def create_campaigns(event_id, headers):
    now = datetime.now(timezone.utc)
    first_time = (now + timedelta(minutes=2)).isoformat().replace("+00:00", "Z")
    second_time = (now + timedelta(hours=16)).isoformat().replace("+00:00", "Z")

    payload = {
        "items": [
            {
                "name": "Save the Date",
                "template": "event_no_pic",
                "channel": "whatsapp",
                "schedule_time": first_time,
                "status": "pending"
            },
            {
                "name": "Reminder",
                "template": "event_no_pic",
                "channel": "whatsapp",
                "schedule_time": second_time,
                "status": "pending"
            }
        ]
    }

    resp = requests.post(f"{BASE_URL}/campaigns?event_id={event_id}", json=payload, headers=headers)
    resp.raise_for_status()
    print("Campaigns created:", [c["name"] for c in payload["items"]])
    print("Schedule times:", first_time, "and", second_time)


def main():
    headers = {"Authorization": f"Bearer {TOKEN}"}
    event_id = create_event(headers)
    create_guests(event_id, headers)
    create_campaigns(event_id, headers)
    print("✅ Test setup complete.")

if __name__ == "__main__":
    main()
