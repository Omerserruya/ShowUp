# Outpost Service

A Python service that connects to RabbitMQ and sends WhatsApp messages via the WhatsApp Business Cloud API.

## Features

- **RabbitMQ Integration**: Listens to `outpost_queue` for incoming messages
- **WhatsApp Business API**: Sends messages via Facebook Graph API v17.0
- **Template Support**: Dynamic template parameter injection
- **Retry Logic**: Exponential backoff for network failures
- **Structured Logging**: JSON-formatted logs with python-json-logger
- **Graceful Shutdown**: Handles SIGINT/SIGTERM signals properly

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Campaign      │    │   RabbitMQ      │    │   Outpost       │
│   Worker        │───▶│   outpost_queue │───▶│   Service       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                       │
                                                       ▼
                                               ┌─────────────────┐
                                               │   WhatsApp      │
                                               │   Business API  │
                                               └─────────────────┘
```

## Message Format

The service expects messages in the following format:

```json
{
  "platform": "WA",
  "recipient": "+1234567890",
  "template": "save_the_date",
  "parameters": {
    "name": "John Doe",
    "date": "2025-10-20T15:00:00",
    "event_name": "Wedding",
    "location": "Garden Venue"
  }
}
```

## WhatsApp Template Payload

The service automatically converts parameters to WhatsApp template format:

```json
{
  "messaging_product": "whatsapp",
  "to": "+1234567890",
  "type": "template",
  "template": {
    "name": "save_the_date",
    "language": { "code": "he" },
    "components": [
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "John Doe" },
          { "type": "text", "text": "2025-10-20T15:00:00" },
          { "type": "text", "text": "Wedding" },
          { "type": "text", "text": "Garden Venue" }
        ]
      }
    ]
  }
}
```

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `WA_API_B` | WhatsApp Business API access token | ✅ | - |
| `WA_PHONE_ID` | WhatsApp Business phone number ID | ✅ | - |
| `RABBITMQ_HOST` | RabbitMQ host | ✅ | localhost |
| `RABBITMQ_PORT` | RabbitMQ port | ✅ | 5672 |
| `RABBITMQ_USER` | RabbitMQ username | ✅ | guest |
| `RABBITMQ_PASSWORD` | RabbitMQ password | ✅ | guest |
| `RABBITMQ_VHOST` | RabbitMQ virtual host | ❌ | / |
| `OUTPOST_QUEUE` | Queue name to listen to | ❌ | outpost_queue |
| `LOG_LEVEL` | Logging level | ❌ | INFO |

## Quick Start

1. **Copy environment file**:
   ```bash
   cp env.sample .env
   ```

2. **Configure environment variables**:
   ```bash
   # Edit .env file with your WhatsApp Business API credentials
   WA_API_B=your_whatsapp_business_api_token_here
   WA_PHONE_ID=your_whatsapp_business_phone_number_id_here
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Run the service**:
   ```bash
   python main.py
   ```

## Docker

Build and run with Docker:

```bash
# Build image
docker build -t outpost-service .

# Run container
docker run --env-file .env outpost-service
```

## Docker Compose

Add to your `docker-compose.yml`:

```yaml
version: '3.8'

services:
  outpost-service:
    build: ./outpost-service
    environment:
      - WA_API_B=${WA_API_B}
      - WA_PHONE_ID=${WA_PHONE_ID}
      - RABBITMQ_HOST=rabbitmq
      - RABBITMQ_PORT=5672
      - RABBITMQ_USER=${RABBITMQ_USER}
      - RABBITMQ_PASSWORD=${RABBITMQ_PASSWORD}
      - OUTPOST_QUEUE=outpost_queue
    depends_on:
      - rabbitmq
    restart: unless-stopped

  rabbitmq:
    image: rabbitmq:3-management
    environment:
      - RABBITMQ_DEFAULT_USER=${RABBITMQ_USER}
      - RABBITMQ_DEFAULT_PASS=${RABBITMQ_PASSWORD}
    ports:
      - "5672:5672"
      - "15672:15672"
    restart: unless-stopped
```

## Error Handling

The service includes comprehensive error handling:

- **Network Retries**: Exponential backoff for HTTP requests
- **Message Validation**: Validates required fields before processing
- **Graceful Degradation**: Logs errors without crashing
- **Connection Recovery**: Automatic RabbitMQ reconnection

## Logging

All logs are structured JSON format:

```json
{
  "timestamp": "2025-10-20T15:30:45Z",
  "logger": "outpost",
  "level": "INFO",
  "message": "WhatsApp message sent successfully",
  "recipient": "+1234567890",
  "template": "save_the_date",
  "message_id": "wamid.xxx"
}
```

## Development

### Project Structure

```
outpost-service/
├── main.py                 # Service entry point
├── whatsapp_sender.py     # WhatsApp API integration
├── rabbit_consumer.py     # RabbitMQ consumer
├── utils/
│   ├── __init__.py
│   └── logger.py          # Structured logging setup
├── requirements.txt       # Python dependencies
├── Dockerfile            # Container definition
├── env.sample           # Environment variables template
└── README.md            # This file
```

### Testing

Test the service by sending a message to the RabbitMQ queue:

```python
import json
import pika

# Connect to RabbitMQ
connection = pika.BlockingConnection(pika.ConnectionParameters('localhost'))
channel = connection.channel()

# Declare queue
channel.queue_declare(queue='outpost_queue', durable=True)

# Send test message
message = {
    "platform": "WA",
    "recipient": "+1234567890",
    "template": "save_the_date",
    "parameters": {
        "name": "Test User",
        "date": "2025-10-20T15:00:00",
        "event_name": "Test Event",
        "location": "Test Location"
    }
}

channel.basic_publish(
    exchange='',
    routing_key='outpost_queue',
    body=json.dumps(message),
    properties=pika.BasicProperties(delivery_mode=2)  # Make message persistent
)

print("Test message sent!")
connection.close()
```

## Monitoring

The service logs key metrics:

- Message processing rate
- Success/failure rates
- API response times
- Error details

Monitor these logs to ensure reliable message delivery.
