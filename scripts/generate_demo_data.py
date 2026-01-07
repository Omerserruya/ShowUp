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

CAMPAIGN_TEMPLATES = [
    {
        "name": "הודעת 'שמרו את התאריך'",
        "template": "שלום {{guest.name}}! אנחנו שמחים להזמין אותך ל{{event.name}} שיתקיים ב{{event.date}} ב{{event.location}}. שמרו את התאריך!",
        "channel": "whatsapp"
    },
    {
        "name": "הזמנה ראשונית",
        "template": "שלום {{guest.name}}, הזמנה רשמית ל{{event.name}} ב{{event.date}} ב{{event.location}}. נשמח לראותך!",
        "channel": "whatsapp"
    },
    {
        "name": "תזכורת ראשונה",
        "template": "שלום {{guest.name}}, תזכורת: {{event.name}} יתקיים ב{{event.date}}. אנא אשר/י הגעה.",
        "channel": "whatsapp"
    },
    {
        "name": "תזכורת שנייה",
        "template": "שלום {{guest.name}}, תזכורת אחרונה: {{event.name}} ב{{event.date}}. אנא אשר/י הגעה בהקדם.",
        "channel": "whatsapp"
    },
    {
        "name": "הודעת תודה",
        "template": "שלום {{guest.name}}, תודה רבה שהגעת ל{{event.name}}! היה לנו כיף לראות אותך.",
        "channel": "whatsapp"
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


def create_event(conn, user_id, event_name=None, event_date=None, location="אולם אירועים, תל אביב"):
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
            location,
            True,
            now,
            now
        ))
        
        event_id = cur.fetchone()[0]
        conn.commit()
        print(f"✓ Created event: {event_name} - ID: {event_id}")
        return event_id


def create_campaigns(conn, event_id, event_date):
    """Create demo campaigns for the event."""
    campaigns = []
    now = datetime.now(timezone.utc)
    
    # Schedule campaigns at different times relative to event
    campaign_schedules = [
        (event_date - timedelta(days=90), CAMPAIGN_TEMPLATES[0], "sent"),  # Save the date - 90 days before
        (event_date - timedelta(days=60), CAMPAIGN_TEMPLATES[1], "sent"),  # Initial invite - 60 days before
        (event_date - timedelta(days=30), CAMPAIGN_TEMPLATES[2], "pending"),  # First reminder - 30 days before
        (event_date - timedelta(days=7), CAMPAIGN_TEMPLATES[3], "pending"),  # Second reminder - 7 days before
        (event_date + timedelta(days=1), CAMPAIGN_TEMPLATES[4], "pending"),  # Thank you - 1 day after
    ]
    
    with conn.cursor() as cur:
        for schedule_time, template_data, status in campaign_schedules:
            campaign_id = uuid.uuid4()
            cur.execute("""
                INSERT INTO campaigns (id, event_id, name, template, channel, schedule_time, status, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                str(campaign_id),
                str(event_id),
                template_data["name"],
                template_data["template"],
                template_data["channel"],
                schedule_time,
                status,
                now,
                now if status == "sent" else schedule_time
            ))
            
            campaign_id = cur.fetchone()[0]
            campaigns.append(campaign_id)
            print(f"  ✓ Created campaign: {template_data['name']} ({status})")
    
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
        
        print("=" * 60)
        print("✓ Demo data generation completed successfully!")
        print("=" * 60)
        print()
        print("Summary:")
        print(f"  User ID: {user_id}")
        print(f"  Event ID: {event_id}")
        print(f"  Campaigns: {len(campaigns)}")
        print(f"  Guests: {len(guests)}")
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

