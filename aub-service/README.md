
User onboarding/auth via OTP. Persists users in Postgres, issues/verifies OTP with Redis, publishes OTP messages to RabbitMQ (e.g., WhatsApp via `outpost-service`), and issues a JWT on successful verification.
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
	- `OTP_TTL_SEC` (OTP expiration in seconds
- JWT
	- `JWT_SECRET` (HMAC secret used to sign access tokens)
	- `JWT_EXP_SECONDS` (JWT expiration in seconds)
- Optional (template hints for message payload)
	- `WHATSAPP_OTP_TEMPLATE` (default template name if set)
	- `WHATSAPP_LANG` (e.g., `en_US`)

### Data Model
| Field           | Descrive                        | Type           |
| --------------- | ------------------------------- | -------------- |
| **id**          | מזהה ייחודי למשתמש              | `UUID`         |
| **phone**       | מספר טלפון לאימות ושליחת OTP    | `VARCHAR(20)`  |
| **email**       | כתובת אימייל (אופציונלי)        | `VARCHAR(100)` |
| **first_name**  | שם פרטי                         | `VARCHAR(100)` |
| **last_name**   | שם משפחה                        | `VARCHAR(100)` |
| **is_verified** | האם המשתמש עבר אימות OTP בהצלחה | `BOOLEAN`      |
| **created_at**  | תאריך ושעת יצירת המשתמש         | `TIMESTAMP`    |
| **updated_at**  | תאריך ושעת עדכון אחרון          | `TIMESTAMP`    |
| **last_login**  | התחברות אחרונה למערכת           | `TIMESTAMP`    |
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
	- Requires `first_name` and `last_name`.
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
	- Verifies `code` for `phone`. Tracks attempts (max 5) with same TTL as OTP. On success sets `is_verified=true`, updates `last_login`, and issues a JWT that expires in `JWT_EXP_SECONDS`.
	- Request example:
```json
{
"phone": "15551234567",
"code": "392144"
}
```
	- Responses:
		- 200: `{ "access_token": "<jwt>" }`
		- 400: `{ "error": "otp_expired_or_missing" }` or `{ "error": "invalid_code", "attempts": n }`
		- 429: `{ "error": "too_many_attempts" }`

### OTP Message (enqueued to RabbitMQ)
Published to `OTP_QUEUE_NAME` with structure:

```json
{
"platform": "WA",
"recipient": <PHONE_NUMBER>,
"code": <OTP_CODE>,
}
```

