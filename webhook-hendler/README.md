# Webhook Handler Service

A FastAPI-based webhook handler service that can receive and process webhooks from various sources.

## Features

- **Generic webhook endpoint** (`/webhook`) - accepts any POST request
- **Typed webhook endpoints** (`/webhook/{type}`) - handles specific webhook types
- **Built-in handlers** for GitHub, Stripe, and Slack webhooks
- **Event storage** - stores webhook events in memory (configurable)
- **Health checks** - `/health` endpoint for monitoring
- **Event management** - list, view, and clear webhook events
- **Comprehensive logging** - detailed logging of all webhook events

## API Endpoints

### Core Endpoints
- `GET /` - Root endpoint with service status
- `GET /health` - Health check endpoint
- `POST /webhook` - Generic webhook receiver
- `POST /webhook/{type}` - Typed webhook receiver (github, stripe, slack)

### Management Endpoints
- `GET /wa` - List all webhook events (last 10)
- `GET /wa/{event_id}` - Get specific webhook event
- `DELETE /wa` - Clear all webhook events

## Usage

### Running Locally

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Run the application:
```bash
python main.py
```

The service will be available at `http://localhost:8000`

### Running with Docker

1. Build the Docker image:
```bash
docker build -t webhook-handler .
```

2. Run the container:
```bash
docker run -p 8000:8000 -e PORT=8000 webhook-handler
```

### Testing Webhooks

#### Generic Webhook
```bash
curl -X POST http://localhost:8000/webhook \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello from webhook!"}'
```

#### Typed Webhook
```bash
curl -X POST http://localhost:8000/webhook/github \
  -H "Content-Type: application/json" \
  -d '{"action": "push", "repository": {"name": "test-repo"}}'
```

#### View Webhook Events
```bash
curl http://localhost:8000/wa
```

## Configuration

The service uses in-memory storage by default. For production use, consider:

- Replacing in-memory storage with a database (PostgreSQL, MongoDB, etc.)
- Adding authentication/authorization
- Implementing webhook signature verification
- Adding rate limiting
- Setting up proper logging and monitoring

## Webhook Types

### GitHub Webhooks
Handles GitHub webhook events like push, pull request, issues, etc.

### Stripe Webhooks
Processes Stripe payment events like successful payments, failed charges, etc.

### Slack Webhooks
Handles Slack webhook events and slash commands.

## Development

The service is built with:
- **FastAPI** - Modern, fast web framework
- **Uvicorn** - ASGI server
- **Pydantic** - Data validation
- **Python 3.11** - Latest Python features

## API Documentation

Once running, visit `http://localhost:8000/docs` for interactive API documentation powered by Swagger UI.
