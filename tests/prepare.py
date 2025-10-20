import requests
import random
import string
from datetime import datetime, timedelta, timezone

BASE_URL = "http://localhost/api"
TOKEN= "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiMTk5MDJjOGMtMzZkNC00MDIxLWE3YWItNDdlMzgzNWU4ZjQ4Iiwic3ViIjoiMTIzNDU2Nzg5IiwiaWF0IjoxNzYwOTc0NDk4LCJleHAiOjE3NjA5NzgwOTh9.O3g1gsfSu2CcGwMFqT3o7Lt1Xr6LXbxCm4eoPJfbQ2I"

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
    for i in range(1, 101):
        name = f"Guest {i}"
        phone = f"+1{random.randint(1000000, 999999999)}"
        guest_count = random.randint(1, 3)
        items.append({
            "name": name,
            "phone": phone,
            "guest_count": guest_count
        })
    payload = {"items": items}
    resp = requests.post(f"{BASE_URL}/guests?event_id={event_id}", json=payload, headers=headers)
    resp.raise_for_status()
    print("Guests uploaded:", len(items))

from datetime import datetime, timedelta, timezone

def create_campaigns(event_id, headers):
    now = datetime.now(timezone.utc)
    first_time = (now + timedelta(minutes=2)).isoformat().replace("+00:00", "Z")
    second_time = (now + timedelta(minutes=4)).isoformat().replace("+00:00", "Z")

    payload = {
        "items": [
            {
                "name": "Save the Date",
                "template": "save_the_date",
                "channel": "whatsapp",
                "schedule_time": first_time,
                "status": "pending"
            },
            {
                "name": "Reminder",
                "template": "reminder",
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
