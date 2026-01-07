# OTP Worker

Worker service that consumes OTP messages from RabbitMQ and sends them via Telegram (currently) or WhatsApp (future).

## Overview

The OTP Worker listens to the `otp_queue` RabbitMQ queue and processes messages containing phone numbers and OTP codes. Currently, it sends OTP codes via Telegram to a fixed chat ID. In the future, it can be extended to support WhatsApp.

## Architecture

The service is divided into clean, modular functions:

- **`worker.py`**: Main worker that consumes messages from RabbitMQ
- **`mq.py`**: RabbitMQ connection utilities
- **`telegram_sender.py`**: Telegram sending functionality

## Message Format

Messages consumed from `otp_queue` should be in JSON format:

```json
{
    "phone": "+972501234567",
    "code": "123456"
}
```

## Environment Variables

- `RABBITMQ_HOST`: RabbitMQ host (default: `rabbitmq`)
- `RABBITMQ_PORT`: RabbitMQ port (default: `5672`)
- `RABBITMQ_USER`: RabbitMQ username (default: `guest`)
- `RABBITMQ_PASSWORD`: RabbitMQ password (default: `guest`)
- `OTP_QUEUE_NAME`: Queue name to consume from (default: `otp_queue`)
- `TELEGRAM_BOT_TOKEN`: Telegram bot token (required for Telegram sending)
- `TELEGRAM_CHAT_ID`: Telegram chat ID to send messages to (required for Telegram sending)

## Usage

### Running with Docker Compose

The service is configured in `docker-compose.yml` and will start automatically.

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
export TELEGRAM_BOT_TOKEN=your_bot_token
export TELEGRAM_CHAT_ID=your_chat_id
```

3. Run the worker:
```bash
python worker.py
```

## Future Enhancements

- WhatsApp integration support
- Support for multiple messaging channels
- Retry logic for failed sends
- Message delivery status tracking

