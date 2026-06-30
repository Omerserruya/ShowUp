# OTP Worker

Worker service that consumes OTP messages from RabbitMQ and delivers them over **WhatsApp** using the approved Hebrew authentication template named **`otp`**. WhatsApp is the single, canonical channel for verification codes - there is no other delivery channel or fallback.

## Overview

The OTP Worker listens to the `otp_queue` RabbitMQ queue and processes messages containing a phone number and an OTP code. For each message it sends the `otp` WhatsApp authentication template (via the Meta Cloud API) to the recipient. Transient send failures are requeued and retried.

## Architecture

- **`worker.py`**: Main worker that consumes messages from RabbitMQ
- **`mq.py`**: RabbitMQ connection utilities
- **`whatsapp_sender.py`**: WhatsApp template (`otp`) sending functionality

## Message Format

Messages consumed from `otp_queue` should be in JSON format:

```json
{
    "platform": "WA",
    "recipient": "+972501234567",
    "code": "123456"
}
```

(`phone` is accepted as an alias for `recipient` for backward compatibility.)

## Environment Variables

- `RABBITMQ_HOST`: RabbitMQ host (default: `rabbitmq`)
- `RABBITMQ_PORT`: RabbitMQ port (default: `5672`)
- `RABBITMQ_USER`: RabbitMQ username (default: `guest`)
- `RABBITMQ_PASSWORD`: RabbitMQ password (default: `guest`)
- `OTP_QUEUE_NAME`: Queue name to consume from (default: `otp_queue`)
- `WA_API_B`: WhatsApp Cloud API access token (**required**)
- `WA_PHONE_ID`: WhatsApp Business phone-number ID (**required**)
- `WA_OTP_TEMPLATE_NAME`: Authentication template name (default: `otp`)
- `WA_OTP_LANG`: Template language code (default: `he`)
- `WA_OTP_WITH_BUTTON`: Include the one-tap/copy-code button parameter (default: `true`; set `false` only if the approved template is body-only)
- `WA_API_VERSION`: Graph API version (default: `v22.0`)

## Usage

### Running with Docker Compose

The service is configured in `docker-compose.yml` / `docker-compose.dev.yml` and starts automatically.

### Running Locally

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Set environment variables:
```bash
export RABBITMQ_HOST=localhost
export RABBITMQ_PORT=5672
export RABBITMQ_USER=guest
export RABBITMQ_PASSWORD=guest
export OTP_QUEUE_NAME=otp_queue
export WA_API_B=your_whatsapp_token
export WA_PHONE_ID=your_phone_number_id
```

3. Run the worker:
```bash
python worker.py
```
