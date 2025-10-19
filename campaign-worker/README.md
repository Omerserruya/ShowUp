## Campaign Worker

Python worker that consumes scheduled campaigns, fetches guests for the event, renders WhatsApp template messages per guest, enqueues messages to the outpost send queue, and ensures idempotency to avoid duplicates.

### Environment Variables

- Database (Postgres)
  - `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- RabbitMQ
  - `RABBITMQ_HOST`, `RABBITMQ_PORT`, `RABBITMQ_USER`, `RABBITMQ_PASSWORD`
  - `RABBITMQ_HEARTBEAT` (default 60)
  - `RABBITMQ_BLOCKED_TIMEOUT` (default 300)
- Queues
  - `CAMPAIGNS_QUEUE` (default: campaigns)
  - `OUTPOST_QUEUE_NAME` (default: outpost_send)

### Message Flow

1) Consume campaign from `CAMPAIGNS_QUEUE`:
```json
{
  "campaign_id": "uuid",
  "event_id": "uuid",
  "payload": {
    "template_name": "otp_template",
    "params": { "lang": "en_US" }
  }
}
```

2) Fetch guests for `event_id` from Postgres (`guests` table)
3) For each guest:
   - Validate/merge template params
   - Build WhatsApp Cloud API template payload
   - Publish to `OUTPOST_QUEUE_NAME`
   - Mark `(campaign_id, guest_id)` as sent (idempotency)

### Tables

- `guests(id, event_id, name, phone, email, ...)`
- `messages_sent(campaign_id UUID, guest_id UUID, PRIMARY KEY (campaign_id, guest_id))`

### Extensibility

- Channel-agnostic: swap `build_whatsapp_template_payload` with channel-specific builders
- Template specs can be loaded from DB/config instead of hardcoded

### Run

```bash
python worker.py
```

### Docker

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "worker.py"]
```


