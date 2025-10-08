## AUB Service

User onboarding/auth via OTP. Persists users in Postgres, issues/verifies OTP with Redis, and publishes OTP messages to RabbitMQ for delivery (e.g., WhatsApp via `outpost-service`).

### Environment Variables

- Postgres
  - `DB_HOST`
  - `DB_PORT`
  - `DB_USER`
  - `DB_PASSWORD`
  - `DB_NAME`
- RabbitMQ
  - `RABBITMQ_HOST`
  - `RABBITMQ_PORT`
  - `RABBITMQ_USER`
  - `RABBITMQ_PASSWORD`
  - `OUTPOST_QUEUE_NAME` (queue for OTP messages)
- Redis
  - `REDIS_HOST`
  - `REDIS_PORT`
- OTP
  - `OTP_TTL_SEC` (OTP expiration in seconds)
- Optional (template hints for message payload)
  - `WHATSAPP_OTP_TEMPLATE` (default template name if set)
  - `WHATSAPP_LANG` (e.g., `en_US`)

### Data Model

Table `users`:
- `id` (UUID, PK)
- `phone` (VARCHAR(20), unique)
- `email` (VARCHAR(100), nullable)
- `first_name` (VARCHAR(100), nullable)
- `last_name` (VARCHAR(100), nullable)
- `is_verified` (BOOLEAN, default false)
- `created_at`, `updated_at` (TIMESTAMP)

Table is ensured on demand. If you already have a `users` table without the new columns, migrate it accordingly.

### Redis Keys

- `otp:{phone}` → JSON `{ "code": "392144", "attempts": 0 }` with TTL=`OTP_TTL_SEC`
- `otp_attempts:{phone}` → integer attempts with TTL=`OTP_TTL_SEC`

### Routes

- GET `/health`
  - 200 if Postgres, RabbitMQ, and Redis are reachable; else 503.
  - Response: `{ "db": true|false, "rabbit": true|false, "redis": true|false }`

- POST `/register`
  - Creates a new user. If `phone` already exists → 409 and no OTP is generated.
  - On success: generates OTP, stores in Redis with TTL=`OTP_TTL_SEC`, enqueues a WhatsApp template message to RabbitMQ.
  - Request example:
    ```json
    {
      "phone": "15551234567",
      "email": "user@example.com",
      "first_name": "John",
      "last_name": "Doe"
    }
    ```
  - Responses:
    - 200: `{ "status": "otp_sent" }`
    - 409: `{ "error": "user_exists" }`

- POST `/login`
  - Issues a new OTP for an existing user (same flow as register OTP).
  - Request example:
    ```json
    { "phone": "15551234567" }
    ```
  - Responses:
    - 200: `{ "status": "otp_sent" }`
    - 404: `{ "error": "user_not_found" }`

- POST `/verify-otp`
  - Verifies `code` for `phone`. Tracks attempts (max 5) with same TTL as OTP. On success sets `is_verified=true`.
  - Request example:
    ```json
    {
      "phone": "15551234567",
      "code": "392144"
    }
    ```
  - Responses:
    - 200: `{ "status": "verified" }`
    - 400: `{ "error": "otp_expired_or_missing" }` or `{ "error": "invalid_code", "attempts": n }`
    - 429: `{ "error": "too_many_attempts" }`

### OTP Message (enqueued to RabbitMQ)

Published to `OUTPOST_QUEUE_NAME` with structure:
```json
{
  "platform": "WhatsApp",
  "recipient": "15551234567",
  "content": {
    "template": {
      "name": "otp_template",
      "language": { "code": "en_US" },
      "components": [
        { "type": "body", "parameters": [ { "type": "text", "text": "392144" } ] }
      ]
    }
  }
}
```


