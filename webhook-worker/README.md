# Webhook Worker Service

A worker service that consumes WhatsApp webhook messages from the `webhook_queue` and processes them based on their topics, then forwards processed messages to the outpost service.

## Features

- **RabbitMQ Consumer** - Consumes messages from `webhook_queue`
- **Topic-Based Processing** - Handles different message types:
  - `contacts` - Creates contact summary and sends to outpost
  - `message` - Returns message as text
  - `quick_reply` - Replies with "Yes"
- **Outpost Integration** - Forwards processed messages to outpost queue
- **Message Properties** - Adds `message_type` property for template vs free text handling
- **Retry Logic** - Robust connection handling with exponential backoff

## Environment Variables

### Required Environment Variables:
- `RABBITMQ_HOST` - RabbitMQ host
- `RABBITMQ_PORT` - RabbitMQ port
- `RABBITMQ_USER` - RabbitMQ username
- `RABBITMQ_PASSWORD` - RabbitMQ password

### Optional Environment Variables:
- `WEBHOOK_QUEUE` - Source queue name (default: "webhook_queue")
- `OUTPOST_QUEUE` - Target queue name (default: "outpost_queue")

## Message Processing

### Contact Messages
- Extracts contact name and phone numbers
- Creates summary text: "Contact shared: {name} - {phone}"
- Sends to outpost queue with `message_type: "free_text"`

### Regular Messages
- Extracts text content and media type
- Returns message as text or media description
- Sends to outpost queue with `message_type: "free_text"`

### Quick Reply Messages
- Extracts button information
- Replies with "Yes"
- Sends to outpost queue with `message_type: "free_text"`

## Outpost Message Format

Each processed message sent to outpost queue:

```json
{
  "recipient": "sender_phone_number",
  "message_id": "original_message_id",
  "text": "processed_text_content",
  "message_type": "free_text",
  "template_id": null,
  "template_params": null,
  "processed_at": "2024-01-01T00:00:00Z",
  "source": "webhook_worker",
  "original_type": "contacts|message|quick_reply",
  "button_id": "button_id_if_applicable",
  "button_title": "button_title_if_applicable"
}
```

## Message Type Properties

The worker adds `message_type` property to help outpost service distinguish between:

- **`free_text`** - Regular text messages (24-hour window)
- **`template`** - Template-based messages (future implementation)

## Usage

### Running Locally

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Set environment variables:
```bash
export RABBITMQ_HOST="localhost"
export RABBITMQ_PORT="5672"
export RABBITMQ_USER="guest"
export RABBITMQ_PASSWORD="guest"
export WEBHOOK_QUEUE="webhook_queue"
export OUTPOST_QUEUE="outpost_queue"
```

3. Run the worker:
```bash
python worker.py
```

### Running with Docker

1. Build the Docker image:
```bash
docker build -t webhook-worker .
```

2. Run the container:
```bash
docker run \
  -e RABBITMQ_HOST="rabbitmq" \
  -e RABBITMQ_PORT="5672" \
  -e RABBITMQ_USER="guest" \
  -e RABBITMQ_PASSWORD="guest" \
  -e WEBHOOK_QUEUE="webhook_queue" \
  -e OUTPOST_QUEUE="outpost_queue" \
  webhook-worker
```

## Dependencies

- **aio-pika** - Async RabbitMQ client
- **tenacity** - Retry logic for robust connections
- **Python 3.11** - Async/await support

## Integration with Outpost Service

The outpost service should check the `message_type` property:

- **`free_text`** - Send as regular text message (24-hour window)
- **`template`** - Send as template message (future implementation)

This allows the outpost service to handle different message types appropriately within WhatsApp's messaging rules.
