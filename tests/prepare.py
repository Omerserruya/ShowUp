import requests
import random
import string
from datetime import datetime, timedelta, timezone

# BASE_URL = "https://dev.28042000.xyz/api" 
BASE_URL =  "http://localhost/api" 
TOKEN= "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiYmY5ZGY2ZjQtNTUwMy00N2RhLTgxMTYtOWI4NTc4MTg1YWFjIiwic3ViIjoiMTIzNDU2Nzg5IiwiaWF0IjoxNzY0NjYyNTIyLCJleHAiOjE3NjQ2NjYxMjJ9.IQZbOlAppoo3mcmXkMM1hboDcEIlW6ZH84FeVg73XXs"

def create_event(headers):
    payload = {
        "name": "חתונה",
        "description": "חתונה של עומר ושני",
        "event_date": "2025-12-31T18:00:00Z",
        "location": "אולמי חרטא",
        "inviters": [
        {"fn": "שני", "ln": "יצחק"},
        {"fn": "עומר", "ln": "צרויה"}
    ]
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
        "import_count": 1, 
        "table_number": 1,
        "group": "family"
    })
  
    payload = {"items": items}
    resp = requests.post(f"{BASE_URL}/guests?event_id={event_id}", json=payload, headers=headers)
    resp.raise_for_status()
    print("Guests uploaded:", len(items))

from datetime import datetime, timedelta, timezone

def create_campaigns(event_id, headers):
    now = datetime.now(timezone.utc)
    first_time = (now + timedelta(seconds=62)).isoformat().replace("+00:00", "Z")
    second_time = (now + timedelta(minutes=4)).isoformat().replace("+00:00", "Z")
    third_time = (now + timedelta(minutes=7)).isoformat().replace("+00:00", "Z")
    fourth_time = (now + timedelta(minutes=10)).isoformat().replace("+00:00", "Z")
    fifth_time = (now + timedelta(minutes=13)).isoformat().replace("+00:00", "Z")

    payload = {
        "items": [
            # {
            #     "name": "Save the Date",
            #     "template": "general_rsvp",
            #     "channel": "whatsapp",
            #     "schedule_time": first_time,
            #     "status": "pending"
            # },
            # {
            #     "name": "reminder",
            #     "template": "reminder",
            #     "channel": "whatsapp",
            #     "schedule_time": second_time,
            #     "status": "pending"
            # },
            # {
            #     "name": "remind about event",
            #     "template": "event_remind",
            #     "channel": "whatsapp",
            #     "schedule_time": third_time,    
            #     "status": "pending"

            # },
            {
                "name": "table assignment",
                "template": "table_info",
                "channel": "whatsapp",
                "schedule_time": first_time ,
                "status": "pending"
            },
            # {
            #     "name":"thank you",
            #     "template":"thank_you",
            #     "channel":"whatsapp",
            #     "schedule_time": first_time,
            #     "status":"pending"
            # }
        ]
    }

    resp = requests.post(f"{BASE_URL}/campaigns?event_id={event_id}", json=payload, headers=headers)
    resp.raise_for_status()
    print("Campaigns created:", [c["name"] for c in payload["items"]])
    print("Schedule times:",  [c["schedule_time"] for c in payload["items"]])


def main():
    headers = {"Authorization": f"Bearer {TOKEN}"}
    event_id = create_event(headers)
    create_guests(event_id, headers)
    create_campaigns(event_id, headers)
    print("✅ Test setup complete.")

if __name__ == "__main__":
    main()
