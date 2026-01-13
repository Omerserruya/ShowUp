# Contact Import Worker

A Python worker that consumes WhatsApp contact import messages from RabbitMQ and creates import records in the database without immediately creating guests.

## Overview

This worker is part of the WhatsApp Contacts import flow:

1. **Webhook Handler** receives WhatsApp webhook events and pushes contact messages to `contact_import_queue`
2. **Contact Import Worker** (this service) consumes messages and:
   - Extracts sender phone and contacts array
   - Finds the most recent active event for the sender (by owner phone)
   - Creates import records (`guest_imports` and `guest_import_contacts`) if event exists
   - Sends a message via Outpost if no active event exists
3. **Future processing** will validate and create guests from import records

## Features

- **Idempotent Processing**: Uses WhatsApp message ID to prevent duplicate imports
- **Event Resolution**: Finds active events by owner phone number
- **Partial Failure Handling**: Continues processing even if individual contacts fail
- **No Guest Creation**: Only creates import records (guests created later in pipeline)

## Environment Variables

### Database (Postgres)
- `DB_HOST` - Database host
- `DB_PORT` - Database port (default: 5432)
- `DB_USER` - Database user
- `DB_PASSWORD` - Database password
- `DB_NAME` - Database name

### RabbitMQ
- `RABBITMQ_HOST` - RabbitMQ host
- `RABBITMQ_PORT` - RabbitMQ port (default: 5672)
- `RABBITMQ_USER` - RabbitMQ username
- `RABBITMQ_PASSWORD` - RabbitMQ password
- `RABBITMQ_HEARTBEAT` - Heartbeat interval (default: 60)
- `RABBITMQ_BLOCKED_TIMEOUT` - Blocked connection timeout (default: 300)

### Queues
- `CONTACT_IMPORT_QUEUE` - Queue name for contact imports (default: `contact_import_queue`)
- `OUTPOST_QUEUE_NAME` - Queue name for Outpost service (default: `outpost_queue`)

## Message Format

Consumes messages from `contact_import_queue`:

```json
{
  "message_id": "wamid.xxx",
  "sender_phone": "+972525401686",
  "raw_message": {
    "id": "wamid.xxx",
    "from": "972525401686",
    "type": "contacts",
    "contacts": [
      {
        "name": {
          "formatted_name": "John Doe"
        },
        "phones": [
          {
            "phone": "+1234567890",
            "type": "MOBILE"
          }
        ],
        "emails": [
          {
            "email": "john@example.com",
            "type": "WORK"
          }
        ]
      }
    ]
  },
  "received_at": "2025-01-20T10:00:00Z"
}
```

## Database Tables

### guest_imports
- `id` (UUID) - Primary key
- `event_id` (UUID) - Foreign key to events
- `source` (VARCHAR) - Import source (e.g., "whatsapp")
- `raw_payload` (TEXT) - Full message as JSON
- `status` (VARCHAR) - Import status (pending, processing, completed, failed)
- `message_id` (VARCHAR) - WhatsApp message ID for idempotency (unique)
- `created_at` (TIMESTAMPTZ)
- `updated_at` (TIMESTAMPTZ)

### guest_import_contacts
- `id` (UUID) - Primary key
- `import_id` (UUID) - Foreign key to guest_imports
- `name` (VARCHAR) - Contact name
- `phone` (VARCHAR) - Contact phone number
- `email` (VARCHAR) - Contact email
- `status` (VARCHAR) - Contact status (pending, validated, imported, failed)
- `validation_errors` (TEXT) - JSON array of validation errors
- `created_at` (TIMESTAMPTZ)

## Processing Flow

1. **Consume Message**: Worker consumes message from `contact_import_queue`
2. **Idempotency Check**: Check if `message_id` already exists in `guest_imports`
3. **Event Resolution**: 
   - Normalize sender phone number
   - Query active events ordered by `created_at DESC`
   - For each event, get owner phone numbers from `users` table
   - Return first matching event
4. **No Event Found**: Send Hebrew message via Outpost service
5. **Event Found**: 
   - Create `guest_import` record with status "pending"
   - Extract contacts from `raw_message.contacts`
   - Create `guest_import_contact` records for each contact
   - Log results

## Error Handling

- **Invalid Message**: Log error and acknowledge (don't requeue)
- **Processing Error**: Log error and nack with requeue (for transient errors)
- **Partial Contact Failures**: Continue processing remaining contacts

## Dependencies

- `pika` - RabbitMQ client
- `psycopg2-binary` - PostgreSQL adapter
- `tenacity` - Retry logic

## Run

```bash
python worker.py
```

## Docker

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "worker.py"]
```

## Notes

- **Owner Phone Lookup**: The worker queries the `users` table to get phone numbers from owner UUIDs. If the `users` table is in a different database, you may need to implement cross-database lookup or use a shared database.
- **Phone Normalization**: All phone numbers are normalized to digits-only format (e.g., "972525401686") for consistent matching.
- **No Guest Creation**: This worker only creates import records. Guest creation happens in a later stage of the pipeline after validation.

