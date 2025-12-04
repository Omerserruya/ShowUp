# WhatsApp Webhook Handler Service

A FastAPI-based webhook handler service specifically designed to receive, validate, categorize, and enqueue WhatsApp messages from Meta's Business API to RabbitMQ.

## Features

- **HMAC Signature Verification** - Validates requests from Meta using webhook secrets
- **JSON Schema Validation** - Ensures incoming messages match WhatsApp API format
- **Message Categorization** - Automatically categorizes messages as:
  - `quick_reply` - User pressed a reply button
  - `message` - Normal text or media messages
  - `contacts` - User shared contact cards
- **RabbitMQ Integration** - Enqueues categorized messages to `webhook_queue` with topic tags
- **Contact Handling** - Processes multiple contacts individually
- **Health Monitoring** - Built-in health check endpoints

## Environment Variables

### Required Environment Variables:
- `WEBHOOK_VERIFY_TOKEN` - Token for webhook verification (GET endpoint)
- `WEBHOOK_SECRET` - Secret for HMAC signature verification

### Optional Environment Variables:
- `PORT` - Server port (default: 8000)
- `RABBITMQ_HOST` - RabbitMQ host (default: localhost)
- `RABBITMQ_PORT` - RabbitMQ port (default: 5672)
- `RABBITMQ_USER` - RabbitMQ username (default: guest)
- `RABBITMQ_PASSWORD` - RabbitMQ password (default: guest)
- `WEBHOOK_QUEUE` - Queue name for all messages (default: "webhook_queue")

## API Endpoints

### Core Endpoints
- `GET /` - Webhook verification endpoint (for Meta setup)
- `GET /health` - Health check endpoint
- `POST /` - WhatsApp webhook receiver

## Message Processing Flow

1. **Signature Verification** - Validates HMAC signature from Meta
2. **Schema Validation** - Ensures message format is valid
3. **Categorization** - Determines message type (quick_reply, message, contacts)
4. **Data Extraction** - Extracts relevant data based on message type
5. **Queue Enqueuing** - Sends to RabbitMQ `webhook_queue` with topic tag

## Queue Payload Format

Each enqueued message follows this structure:

```json
{
  "event_id": "message_id",
  "recipient": "sender_phone_number",
  "message_id": "message_id",
  "type": "quick_reply|message|contacts",
  "payload": {
    "original_message_data": "...",
    "extracted_data": "..."
  },
  "received_at": "2024-01-01T00:00:00Z",
  "topic": "quick_reply|message|contacts",
  "enqueued_at": "2024-01-01T00:00:00Z"
}
```

## Usage

### Running Locally

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Set environment variables:
```bash
export WEBHOOK_VERIFY_TOKEN="your_verify_token"
export WEBHOOK_SECRET="your_webhook_secret"
export RABBITMQ_HOST="localhost"
export RABBITMQ_PORT="5672"
export RABBITMQ_USER="guest"
export RABBITMQ_PASSWORD="guest"
export WEBHOOK_QUEUE="webhook_queue"
```

3. Run the application:
```bash
python main.py
```

### Running with Docker

1. Build the Docker image:
```bash
docker build -t webhook-handler .
```

2. Run the container:
```bash
docker run -p 8000:8000 \
  -e WEBHOOK_VERIFY_TOKEN="your_token" \
  -e WEBHOOK_SECRET="your_secret" \
  -e RABBITMQ_HOST="rabbitmq" \
  -e RABBITMQ_PORT="5672" \
  -e RABBITMQ_USER="guest" \
  -e RABBITMQ_PASSWORD="guest" \
  -e WEBHOOK_QUEUE="webhook_queue" \
  webhook-handler
```

## Message Types

### Quick Reply Messages
- Triggered when user presses interactive buttons
- Extracts button ID and title
- Tagged with topic: `quick_reply`

### Regular Messages
- Text, image, audio, video, document messages
- Extracts text content and media type
- Tagged with topic: `message`

### Contact Messages
- User-shared contact cards
- Each contact processed individually
- Tagged with topic: `contacts` (with contact index)

## Error Handling

- **400 Bad Request** - Invalid signature, JSON, or schema
- **500 Internal Server Error** - Processing or queuing failures
- All errors are logged with detailed information

## Dependencies

- **FastAPI** - Web framework
- **RabbitMQ (pika)** - Message queuing
- **jsonschema** - Message validation
- **Uvicorn** - ASGI server

## RabbitMQ Integration

The service enqueues all messages to a single `webhook_queue` with topic tags:

- **Queue Name**: `webhook_queue` (configurable via `WEBHOOK_QUEUE` env var)
- **Topic Tagging**: Messages are tagged with topics (`quick_reply`, `message`, `contacts`)
- **Headers**: Topic is also added as RabbitMQ header for easy filtering
- **Durability**: Messages are marked as persistent
- **Easy Routing**: Workers can filter by topic to process specific message types

### Worker Integration Example:
```python
import pika
import json

connection = pika.BlockingConnection(pika.URLParameters('amqp://localhost:5672'))
channel = connection.channel()

def process_message(ch, method, properties, body):
    message = json.loads(body)
    topic = properties.headers.get('topic')
    
    if topic == 'quick_reply':
        # Process quick reply
        pass
    elif topic == 'contacts':
        # Process contact
        pass
    else:
        # Process regular message
        pass
    
    ch.basic_ack(delivery_tag=method.delivery_tag)

channel.basic_consume(queue='webhook_queue', on_message_callback=process_message)
channel.start_consuming()
```

## Production Considerations

- Ensure RabbitMQ is properly configured and accessible
- Set up monitoring for queue health
- Configure proper logging levels
- Consider message persistence and durability
- Implement proper error alerting