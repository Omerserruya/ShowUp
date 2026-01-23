#!/usr/bin/env python3
"""
Script to generate demo data for ShowUp application.
Creates a user, event, campaigns, and guests with various response statuses.

Usage:
    python scripts/generate_demo_data.py

Environment variables required:
    DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME

The script will try to load variables from:
    1. .env file in project root (if python-dotenv is installed)
    2. Environment variables

Optional: Install python-dotenv for .env file support:
    pip install python-dotenv

Note: This script only writes to the database directly. It does not connect to
      RabbitMQ as it only creates data records (user, event, campaigns, guests),
      not sends messages. If you need to send OTP or other messages, use the
      appropriate API endpoints or services.
"""

import os
import sys
import uuid
import random
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import psycopg2
from psycopg2.extras import execute_values, Json

# Try to load .env file if python-dotenv is available
try:
    from dotenv import load_dotenv
    # Look for .env file in project root (parent of scripts directory)
    env_path = Path(__file__).parent.parent / '.env'
    if env_path.exists():
        load_dotenv(env_path)
        print(f"✓ Loaded environment variables from {env_path}")
    else:
        # Try current directory
        load_dotenv()
except ImportError:
    # python-dotenv not installed, continue without it
    pass

# Hebrew names for realistic demo data
HEBREW_FIRST_NAMES = [
    "דוד", "שרה", "יוסף", "רחל", "אברהם", "מרים", "יעקב", "לאה",
    "משה", "אסתר", "אהרון", "רבקה", "יצחק", "דינה", "בנימין", "תמר",
    "יונתן", "רות", "שמואל", "חוה", "דניאל", "נעמי", "אליהו", "שושנה"
]

HEBREW_LAST_NAMES = [
    "כהן", "לוי", "ישראל", "דוד", "מזרחי", "אברהם", "יעקב", "משה",
    "יוסף", "אהרון", "יצחק", "בנימין", "דניאל", "שמואל", "יונתן", "אליהו"
]

EVENT_NAMES = [
    "חתונת דוד ושרה",
    "בר מצווה של יוסף",
    "בת מצווה של רחל",
    "ברית מילה של אברהם",
    "אירוע חברה - סוף שנה",
    "יום הולדת 50 של משה"
]

# Campaign templates matching template_registry.py and frontend templates.ts
CAMPAIGN_TEMPLATES = [
    {
        "name": "RSVP",
        "template_id": "event_no_pic",  # Template ID from template_registry.py
        "channel": "whatsapp",
        "offset_days": 30,  # 30 days before event
        "time": "10:00"
    },
    {
        "name": "תזכורת שבוע לפני",
        "template_id": "reminder",  # For pending guests
        "channel": "whatsapp",
        "offset_days": 7,  # 7 days before event
        "time": "12:00"
    },
    {
        "name": "תזכורת יום לפני",
        "template_id": "event_remind",  # For all guests
        "channel": "whatsapp",
        "offset_days": 1,  # 1 day before event
        "time": "18:00"
    },
    {
        "name": "תודה אחרי האירוע",
        "template_id": "thank_you",  # For attending guests
        "channel": "whatsapp",
        "offset_days": -1,  # 1 day after event
        "time": "11:00"
    }
]

GUEST_GROUPS = [
    "משפחת החתן", "משפחת הכלה", "חברים", "קולגות", "משפחה מורחבת"
]


def get_db_connection():
    """Create database connection from environment variables."""
    try:
        conn = psycopg2.connect(
            host=os.getenv("DB_HOST", "localhost"),
            port=os.getenv("DB_PORT", "5432"),
            user=os.getenv("DB_USER", "postgres"),
            password=os.getenv("DB_PASSWORD", "postgres"),
            dbname=os.getenv("DB_NAME", "showup")
        )
        return conn
    except Exception as e:
        print(f"Error connecting to database: {e}")
        sys.exit(1)


def create_user(conn, phone="+972525401686", first_name="משתמש", last_name="הדגמא", email="demo@example.com"):
    """Create a demo user in the users table."""
    user_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    
    with conn.cursor() as cur:
        # Check if user already exists
        cur.execute("SELECT id FROM users WHERE phone = %s", (phone,))
        existing = cur.fetchone()
        if existing:
            print(f"User with phone {phone} already exists, using existing user")
            return existing[0]
        
        cur.execute("""
            INSERT INTO users (id, phone, email, first_name, last_name, is_verified, created_at, updated_at, last_login)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (str(user_id), phone, email, first_name, last_name, True, now, now, now))
        
        user_id = cur.fetchone()[0]
        conn.commit()
        print(f"✓ Created user: {first_name} {last_name} ({phone}) - ID: {user_id}")
        return user_id


def create_event(conn, user_id, event_name=None, event_date=None, location=None):
    """Create a demo event."""
    event_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    
    if event_name is None:
        event_name = random.choice(EVENT_NAMES)
    
    if event_date is None:
        # Event in 2 months from now
        event_date = now + timedelta(days=60)
    
    # Create inviters (demo couple)
    inviters = Json([
        {"fn": "דוד", "ln": "כהן"},
        {"fn": "שרה", "ln": "לוי"}
    ])
    
    # Location as JSON object (matching frontend structure)
    if location is None:
        location_obj = {
            "name": "אולם אירועים גרנד",
            "address": "רחוב רוטשילד 10, תל אביב",
            "coordinates": {
                "lat": 32.0853,
                "lng": 34.7818
            }
        }
        # Store as JSON string (core-service expects TEXT/string)
        location_str = json.dumps(location_obj, ensure_ascii=False)
    else:
        location_str = location
    
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO events (id, owners, inviters, name, description, event_date, location, active, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
        """, (
            str(event_id),
            Json([str(user_id)]),  # owners array
            inviters,
            event_name,
            f"אירוע דמו: {event_name}",
            event_date,
            location_str,  # TEXT column - JSON string
            True,
            now,
            now
        ))
        
        event_id = cur.fetchone()[0]
        conn.commit()
        print(f"✓ Created event: {event_name} - ID: {event_id}")
        return event_id


def create_campaigns(conn, event_id, event_date):
    """Create demo campaigns for the event using updated template IDs."""
    campaigns = []
    now = datetime.now(timezone.utc)
    
    with conn.cursor() as cur:
        for template_data in CAMPAIGN_TEMPLATES:
            campaign_id = uuid.uuid4()
            
            # Calculate schedule_time based on offset_days and time
            offset_days = template_data.get("offset_days", 0)
            time_str = template_data.get("time", "12:00")
            [hours, minutes] = time_str.split(":")
            
            # Calculate scheduled time: event_date - offset_days (positive = before, negative = after)
            base_date = event_date.replace(hour=0, minute=0, second=0, microsecond=0)
            scheduled_date = base_date - timedelta(days=offset_days)
            schedule_time = scheduled_date.replace(hour=int(hours), minute=int(minutes))
            
            # Determine status: "sent" if in the past, "pending" if in the future
            status = "sent" if schedule_time < now else "pending"
            
            # For demo data, use reasonable recipient_count
            recipient_count = 50 if status == "sent" else 0

            cur.execute("""
                INSERT INTO campaigns (id, event_id, name, template, channel, schedule_time, status, recipient_count, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                str(campaign_id),
                str(event_id),
                template_data["name"],
                template_data["template_id"],  # Use template_id (e.g., "event_no_pic")
                template_data["channel"],
                schedule_time,
                status,
                recipient_count,
                now,
                now if status == "sent" else schedule_time
            ))
            
            campaign_id = cur.fetchone()[0]
            campaigns.append(campaign_id)
            print(f"  ✓ Created campaign: {template_data['name']} (template={template_data['template_id']}, status={status}, schedule={schedule_time.isoformat()}), recipients={recipient_count}")
    
    conn.commit()
    return campaigns


def create_guests(conn, event_id, num_guests=50):
    """Create demo guests with various response statuses."""
    guests = []
    now = datetime.now(timezone.utc)
    
    # Distribution: 50% confirmed, 20% declined, 30% pending
    statuses = (
        ["attending"] * (num_guests // 2) +
        ["declined"] * (num_guests // 5) +
        ["invited"] * (num_guests - (num_guests // 2) - (num_guests // 5))
    )
    random.shuffle(statuses)
    
    with conn.cursor() as cur:
        for i in range(num_guests):
            guest_id = uuid.uuid4()
            first_name = random.choice(HEBREW_FIRST_NAMES)
            last_name = random.choice(HEBREW_LAST_NAMES)
            name = f"{first_name} {last_name}"
            phone = f"05{random.randint(0, 9)}{random.randint(1000000, 9999999)}"
            email = f"{first_name.lower()}.{last_name.lower()}@example.com"
            status = statuses[i]
            group = random.choice(GUEST_GROUPS)
            
            # Set last_response based on status
            last_response = None
            guest_count = None
            
            if status == "attending":
                # Responded 10-60 days ago
                days_ago = random.randint(10, 60)
                last_response = now - timedelta(days=days_ago)
                guest_count = random.randint(1, 4)  # 1-4 guests
            elif status == "declined":
                # Responded 5-30 days ago
                days_ago = random.randint(5, 30)
                last_response = now - timedelta(days=days_ago)
                guest_count = None
            # else: invited/pending - no response yet
            
            import_count = random.randint(1, 3)
            table_number = random.randint(1, 20) if status == "attending" else None
            
            cur.execute("""
                INSERT INTO guests (id, event_id, name, phone, email, guest_group, status, import_count, guest_count, table_number, notes, last_response, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                str(guest_id),
                str(event_id),
                name,
                phone,
                email,
                group,
                status,
                import_count,
                guest_count,
                table_number,
                f"אורח דמו #{i+1}" if random.random() > 0.7 else None,
                last_response,
                now - timedelta(days=random.randint(70, 90))  # Created 70-90 days ago
            ))
            
            guest_id = cur.fetchone()[0]
            guests.append(guest_id)
    
    conn.commit()
    
    # Print summary
    confirmed = sum(1 for s in statuses if s == "attending")
    declined = sum(1 for s in statuses if s == "declined")
    pending = sum(1 for s in statuses if s == "invited")
    
    print(f"✓ Created {num_guests} guests:")
    print(f"  - Confirmed (attending): {confirmed}")
    print(f"  - Declined: {declined}")
    print(f"  - Pending (invited): {pending}")
    
    return guests


def create_guest_imports(conn, event_id, num_imports=2, contacts_per_import=3):
    """Create demo guest imports with contacts from WhatsApp."""
    imports = []
    now = datetime.now(timezone.utc)
    
    # Phone number of the sender (event owner)
    sender_phone = "972525401686"
    
    with conn.cursor() as cur:
        for i in range(num_imports):
            import_id = uuid.uuid4()
            message_id = f"wamid.{uuid.uuid4().hex.upper()[:40]}"
            
            # Generate contacts for this import
            contacts_data = []
            contact_names = []
            contact_phones = []
            
            for j in range(contacts_per_import):
                first_name = random.choice(HEBREW_FIRST_NAMES)
                last_name = random.choice(HEBREW_LAST_NAMES)
                name = f"{first_name} {last_name}"
                phone = f"+972 5{random.randint(0, 9)}-{random.randint(100, 999)}-{random.randint(1000, 9999)}"
                wa_id = phone.replace("+972 ", "").replace("-", "")
                
                contacts_data.append({
                    "name": {
                        "first_name": first_name,
                        "formatted_name": f"{name} "
                    },
                    "phones": [{
                        "phone": phone,
                        "wa_id": wa_id,
                        "type": "CELL"
                    }]
                })
                contact_names.append(name)
                contact_phones.append(phone)
            
            # Create raw_payload in WhatsApp webhook format
            raw_payload = {
                "from": sender_phone,
                "id": message_id,
                "timestamp": str(int(now.timestamp())),
                "type": "contacts",
                "contacts": contacts_data
            }
            
            # Insert guest_import
            cur.execute("""
                INSERT INTO guest_imports (id, event_id, source, raw_payload, status, message_id, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                str(import_id),
                str(event_id),
                'whatsapp',
                json.dumps(raw_payload, ensure_ascii=False),
                'pending',
                message_id,
                now,
                now
            ))
            
            import_id_result = cur.fetchone()[0]
            
            # Insert guest_import_contacts
            for j, contact_data in enumerate(contacts_data):
                contact_id = uuid.uuid4()
                name = contact_data["name"]["formatted_name"].strip()
                phone = contact_data["phones"][0]["phone"]
                
                cur.execute("""
                    INSERT INTO guest_import_contacts (id, import_id, name, phone, status, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (
                    str(contact_id),
                    str(import_id_result),
                    name,
                    phone,
                    'pending',
                    now
                ))
            
            imports.append(import_id_result)
            print(f"  ✓ Created guest import with {contacts_per_import} contacts")
    
    conn.commit()
    print(f"✓ Created {num_imports} guest imports with {contacts_per_import} contacts each")
    return imports


def main():
    """Main function to generate all demo data."""
    print("=" * 60)
    print("ShowUp Demo Data Generator")
    print("=" * 60)
    print()
    
    # Check environment variables
    required_vars = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"]
    missing = [var for var in required_vars if not os.getenv(var)]
    if missing:
        print(f"Error: Missing required environment variables: {', '.join(missing)}")
        print("\nPlease set the following environment variables:")
        print("  DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME")
        print("\nYou can either:")
        print("  1. Set them as environment variables")
        print("  2. Create a .env file in the project root")
        print("  3. Install python-dotenv: pip install python-dotenv")
        sys.exit(1)
    
    conn = get_db_connection()
    
    try:
        # Create user
        print("1. Creating demo user...")
        user_id = create_user(conn)
        print()
        
        # Create event
        print("2. Creating demo event...")
        event_date = datetime.now(timezone.utc) + timedelta(days=60)
        event_id = create_event(conn, user_id, event_date=event_date)
        print()
        
        # Create campaigns
        print("3. Creating campaigns...")
        campaigns = create_campaigns(conn, event_id, event_date)
        print(f"   Created {len(campaigns)} campaigns")
        print()
        
        # Create guests
        print("4. Creating guests...")
        num_guests = int(os.getenv("NUM_GUESTS", "50"))
        guests = create_guests(conn, event_id, num_guests)
        print()
        
        # Create guest imports
        print("5. Creating guest imports...")
        num_imports = int(os.getenv("NUM_IMPORTS", "2"))
        contacts_per_import = int(os.getenv("CONTACTS_PER_IMPORT", "3"))
        imports = create_guest_imports(conn, event_id, num_imports, contacts_per_import)
        print()
        
        print("=" * 60)
        print("✓ Demo data generation completed successfully!")
        print("=" * 60)
        print()
        print("Summary:")
        print(f"  User ID: {user_id}")
        print(f"  Event ID: {event_id}")
        print(f"  Campaigns: {len(campaigns)}")
        print(f"  Guests: {len(guests)}")
        print(f"  Guest Imports: {len(imports)}")
        print()
        print("You can now use this data to test the application.")
        print("Login with phone: 0521234567")
        print("User name: משתמש הדגמא")
        
    except Exception as e:
        print(f"\n✗ Error generating demo data: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()

