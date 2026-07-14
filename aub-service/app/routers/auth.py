"""
Auth API endpoints
"""
import os
import json
import pika
import psycopg2
import redis
from fastapi import APIRouter, Body, Header, HTTPException
from fastapi.responses import JSONResponse
from fastapi import status
from ..token_utils import create_jwt, verify_jwt


router = APIRouter(prefix="/auth", tags=["auth"])


def get_env():
    return {
        "DB_HOST": os.getenv("DB_HOST"),
        "DB_PORT": int(os.getenv("DB_PORT")),
        "DB_USER": os.getenv("DB_USER"),
        "DB_PASSWORD": os.getenv("DB_PASSWORD"),
        "DB_NAME": os.getenv("DB_NAME"),
        "RABBITMQ_HOST": os.getenv("RABBITMQ_HOST"),
        "RABBITMQ_PORT": int(os.getenv("RABBITMQ_PORT")),
        "RABBITMQ_USER": os.getenv("RABBITMQ_USER"),
        "RABBITMQ_PASSWORD": os.getenv("RABBITMQ_PASSWORD"),
        "OTP_QUEUE_NAME": os.getenv("OTP_QUEUE_NAME"),
        "OUTPOST_QUEUE_NAME": os.getenv("OUTPOST_QUEUE_NAME"),
        "REDIS_HOST": os.getenv("REDIS_HOST"),
        "REDIS_PORT": int(os.getenv("REDIS_PORT")),
        "OTP_TTL_SEC": int(os.getenv("OTP_TTL_SEC")),
        "JWT_EXP_SECONDS": int(os.getenv("JWT_EXP_SECONDS")),
    }


def ensure_users_table(env):
    ddl = (
        "CREATE TABLE IF NOT EXISTS users ("
        "id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
        "phone VARCHAR(20) NOT NULL UNIQUE,"
        "email VARCHAR(100),"
        "first_name VARCHAR(100) NOT NULL,"
        "last_name VARCHAR(100) NOT NULL,"
        "is_verified BOOLEAN NOT NULL DEFAULT FALSE,"
        "last_login TIMESTAMP NULL,"
        "created_at TIMESTAMP NOT NULL DEFAULT NOW(),"
        "updated_at TIMESTAMP NOT NULL DEFAULT NOW(),"
        "role VARCHAR(20) NOT NULL DEFAULT 'user'"
        ")"
    )
    # Ensure pgcrypto for gen_random_uuid (on PG >= 13 can use gen_random_uuid from pgcrypto)
    with psycopg2.connect(
        host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"], password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
    ) as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;")
            cur.execute(ddl)
            # Migration: add role column if missing (existing tables)
            cur.execute(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'user'"
            )
            # Phase 2 (production ops): account suspend + login history.
            cur.execute(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'"
            )
            cur.execute(
                "CREATE TABLE IF NOT EXISTS login_history ("
                "id UUID PRIMARY KEY DEFAULT gen_random_uuid(),"
                "user_id UUID,"
                "phone VARCHAR(20),"
                "success BOOLEAN NOT NULL DEFAULT TRUE,"
                "ip VARCHAR(64),"
                "user_agent TEXT,"
                "created_at TIMESTAMP NOT NULL DEFAULT NOW()"
                ")"
            )
            cur.execute(
                "CREATE INDEX IF NOT EXISTS idx_login_history_created ON login_history (created_at DESC)"
            )


def _check_internal_secret(x_internal_secret):
    expected = os.getenv("INTERNAL_API_SECRET")
    if not expected:
        # Misconfiguration, not an attack: without the secret every internal call
        # (venue owner provisioning, welcome, member lookup) fails. Log loudly so
        # this surfaces instead of silently breaking the B2B2C flow.
        print(
            "[INTERNAL_AUTH] ERROR: INTERNAL_API_SECRET is not set on aub-service; "
            "rejecting internal call. Cross-service (venue/team) features are disabled "
            "until this env var is configured."
        )
        raise HTTPException(status_code=503, detail="internal auth not configured")
    if x_internal_secret != expected:
        raise HTTPException(status_code=403, detail="forbidden")


@router.get("/internal/user-by-phone")
def internal_user_by_phone(phone: str, x_internal_secret: str = Header(None)):
    """Internal: resolve a verified user by phone (cross-service team invites)."""
    _check_internal_secret(x_internal_secret)
    phone = _canonical_phone(phone)
    env = get_env()
    ensure_users_table(env)
    with psycopg2.connect(
        host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"], password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
    ) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, first_name, last_name, phone FROM users WHERE phone = %s", (phone,))
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="user not found")
    return {"user_id": str(row[0]), "first_name": row[1], "last_name": row[2], "phone": row[3]}


@router.post("/internal/users")
def internal_users_by_ids(payload: dict = Body(...), x_internal_secret: str = Header(None)):
    """Internal: batch-resolve users by id (so core-service can show member names)."""
    _check_internal_secret(x_internal_secret)
    ids = payload.get("ids") or []
    if not ids:
        return {"users": []}
    env = get_env()
    ensure_users_table(env)
    with psycopg2.connect(
        host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"], password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
    ) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, first_name, last_name, phone FROM users WHERE id::text = ANY(%s)",
                ([str(i) for i in ids],),
            )
            rows = cur.fetchall()
    return {"users": [{"user_id": str(r[0]), "first_name": r[1], "last_name": r[2], "phone": r[3]} for r in rows]}


def _ensure_user_row(env, phone: str, first_name: str, last_name: str, email=None) -> dict:
    """Create-or-get a user by phone. Marks new users verified (a partner venue /
    a completed payment vouches for them). Returns {user_id, first_name, last_name, phone}."""
    phone = _canonical_phone(phone)  # store/lookup in the same form login uses
    ensure_users_table(env)
    with psycopg2.connect(
        host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"], password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
    ) as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SELECT id, first_name, last_name, phone FROM users WHERE phone = %s", (phone,))
            row = cur.fetchone()
            if row:
                return {"user_id": str(row[0]), "first_name": row[1], "last_name": row[2], "phone": row[3]}
            cur.execute(
                "INSERT INTO users (phone, email, first_name, last_name, is_verified) VALUES (%s, %s, %s, %s, TRUE) "
                "RETURNING id, first_name, last_name, phone",
                (phone, email, first_name, last_name),
            )
            new = cur.fetchone()
            return {"user_id": str(new[0]), "first_name": new[1], "last_name": new[2], "phone": new[3]}


@router.post("/internal/ensure-user")
def internal_ensure_user(payload: dict = Body(...), x_internal_secret: str = Header(None)):
    """Internal: create-or-get a user by phone (used by the venue flow to
    provision an event owner who may not have an account yet)."""
    _check_internal_secret(x_internal_secret)
    phone = (payload or {}).get("phone")
    first_name = (payload or {}).get("first_name")
    last_name = (payload or {}).get("last_name") or ""
    email = (payload or {}).get("email")
    if not phone or not first_name:
        raise HTTPException(status_code=400, detail="phone and first_name are required")
    return _ensure_user_row(get_env(), phone, first_name, last_name, email)


def publish_to_outpost_queue(message: dict, env):
    """Publish an outbound WhatsApp message to the outpost queue (same broker as
    OTP, different queue). outpost-service consumes it and sends via Meta Cloud API."""
    params = pika.ConnectionParameters(
        host=env["RABBITMQ_HOST"],
        port=env["RABBITMQ_PORT"],
        credentials=pika.PlainCredentials(env["RABBITMQ_USER"], env["RABBITMQ_PASSWORD"]),
    )
    connection = pika.BlockingConnection(params)
    channel = connection.channel()
    queue_name = env.get("OUTPOST_QUEUE_NAME")
    channel.queue_declare(queue=queue_name, durable=True)
    body = json.dumps(message, ensure_ascii=False).encode("utf-8")
    channel.basic_publish(
        exchange="",
        routing_key=queue_name,
        body=body,
        properties=pika.BasicProperties(delivery_mode=2),
    )
    channel.close()
    connection.close()


def _venue_welcome_text(venue_name: str, first_name: str, link: str) -> str:
    greeting = f"היי {first_name}," if first_name else "היי,"
    return (
        "💜 ברוכים הבאים ל-ShowUp!\n\n"
        f"{greeting}\n"
        f"האולם {venue_name} הכין עבורכם מרחב אישי לניהול האירוע.\n\n"
        "מכאן תוכלו:\n"
        "✓ לעצב את ההזמנה\n"
        "✓ לנהל את רשימת האורחים\n"
        "✓ לעקוב אחר אישורי ההגעה בזמן אמת\n\n"
        f"להמשך, היכנסו כאן:\n{link}"
    )


@router.post("/internal/notify/venue-welcome")
def internal_notify_venue_welcome(payload: dict = Body(...), x_internal_secret: str = Header(None)):
    """Internal: send the premium WhatsApp welcome for a newly created venue event.

    Business-initiated first contact needs an approved Meta template, so when
    WA_VENUE_WELCOME_TEMPLATE is set we publish a `template` message (ops must
    approve a template with two body params: {{1}}=owner first name, {{2}}=venue
    name). Otherwise we fall back to a `free_text` message (works in dev / inside
    the 24h session window). Best-effort: never raises to the caller."""
    _check_internal_secret(x_internal_secret)
    phone = (payload or {}).get("phone")
    if not phone:
        raise HTTPException(status_code=400, detail="phone is required")
    venue_name = (payload or {}).get("venue_name") or "האולם"
    first_name = (payload or {}).get("first_name") or ""
    event_id = (payload or {}).get("event_id")

    app_base = (os.getenv("APP_BASE_URL") or os.getenv("PUBLIC_BASE_URL") or "").rstrip("/")
    link = f"{app_base}/login" if app_base else "https://app.showup.co.il/login"

    env = get_env()
    template_name = os.getenv("WA_VENUE_WELCOME_TEMPLATE")
    try:
        if template_name:
            message = {
                "platform": "WA",
                "recipient": phone,
                "message_type": "template",
                "template": template_name,
                # Flat body params ({{1}}, {{2}}); the approved template must match.
                "parameters": {"1": first_name or venue_name, "2": venue_name},
                "event_id": event_id,
                "source": "venue_welcome",
            }
        else:
            message = {
                "platform": "WA",
                "recipient": phone,
                "message_type": "free_text",
                "text": _venue_welcome_text(venue_name, first_name, link),
                "event_id": event_id,
                "source": "venue_welcome",
            }
        publish_to_outpost_queue(message, env)
        return {"status": "queued"}
    except Exception as exc:  # best-effort; surface as 200 with a note
        return JSONResponse(status_code=200, content={"status": "skipped", "error": str(exc)})


def _otp_key(phone: str) -> str:
    return f"otp:{phone}"


def _otp_attempts_key(phone: str) -> str:
    return f"otp_attempts:{phone}"


def _issue_otp(phone: str, ttl_sec: int, env):
    code = str(int.from_bytes(os.urandom(3), 'big')).zfill(6)[:6]
    r = redis.Redis(host=env["REDIS_HOST"], port=env["REDIS_PORT"]) 
    # store as JSON
    payload = json.dumps({"code": code, "attempts": 0})
    r.setex(_otp_key(phone), ttl_sec, payload)
    r.setex(_otp_attempts_key(phone), ttl_sec, 0)
    return code


def _enqueue_otp(phone: str, code: str, env):
    # Simplified OTP message for OTP queue
    message = {
        "platform": "WA",
        "recipient": phone,
        "code": code,
    }
    publish_to_otp_queue(message, env)


def publish_to_otp_queue(message: dict, env):
    params = pika.ConnectionParameters(
        host=env["RABBITMQ_HOST"],
        port=env["RABBITMQ_PORT"],
        credentials=pika.PlainCredentials(env["RABBITMQ_USER"], env["RABBITMQ_PASSWORD"]),
    )
    connection = pika.BlockingConnection(params)
    channel = connection.channel()
    queue_name = env.get("OTP_QUEUE_NAME")
    channel.queue_declare(queue=queue_name, durable=True)
    body = json.dumps(message).encode("utf-8")
    channel.basic_publish(
        exchange="",
        routing_key=queue_name,
        body=body,
        properties=pika.BasicProperties(delivery_mode=2),
    )
    channel.close()
    connection.close()


def _canonical_phone(phone: str) -> str:
    """Canonical user-table phone in E.164 form ('+972XXXXXXXXX'). Guarantees the
    same person maps to ONE user row regardless of the input format the caller used
    (05…, 972…, +972…, 00972…). Applied at every user create + lookup so the venue/
    admin-created owner and the login flow resolve to the same user."""
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("0"):          # local Israeli 0XXXXXXXXX
        digits = "972" + digits[1:]
    elif len(digits) == 9:              # bare 9-digit local (no leading 0)
        digits = "972" + digits
    return ("+" + digits) if digits else (phone or "")


def _normalize_wa_msisdn(phone: str) -> str:
    """Normalize a phone to a Meta MSISDN (digits only, no '+'). Handles Israeli
    local numbers (05… → 9725…). The frontend already sends E.164, so most inputs
    arrive as +9725… → 9725…."""
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("0"):  # local Israeli → prepend country code
        digits = "972" + digits[1:]
    return digits


@router.post("/demo/whatsapp")
def demo_whatsapp(payload: dict = Body(...)):
    """Public (marketing): send the ShowUp WhatsApp demo template to a visitor who
    pressed "שלחו לי דמו לוואטסאפ" on the landing page. Requires a name + phone.
    Sends the approved MARKETING template `showup_whatsapp_demo` (body var {{1}} =
    first name); the template's two URL buttons ("בואו נתחיל" → wizard, "דברו איתי"
    → sales WhatsApp) are baked into the approved template on Meta."""
    name = ((payload or {}).get("name") or (payload or {}).get("fullName") or "").strip()
    phone = ((payload or {}).get("phone") or "").strip()
    if not name or not phone:
        raise HTTPException(status_code=400, detail="name and phone are required")

    recipient = _normalize_wa_msisdn(phone)
    if len(recipient) < 9:
        raise HTTPException(status_code=400, detail="invalid phone")

    first_name = name.split()[0] if name else "חברים"
    template_name = os.getenv("WA_DEMO_TEMPLATE_NAME", "showup_whatsapp_demo")
    message = {
        "platform": "WA",
        "recipient": recipient,
        "message_type": "template",
        "template": template_name,
        "language": "he",
        "parameters": {"1": first_name},
        "source": "marketing_demo",
    }
    try:
        publish_to_outpost_queue(message, get_env())
    except Exception as exc:
        return JSONResponse(status_code=502, content={"status": "error", "error": str(exc)})
    return {"status": "sent"}


@router.post("/register")
def register(payload: dict = Body(...)):
    env = get_env()
    phone = _canonical_phone((payload or {}).get("phone"))
    email = (payload or {}).get("email")
    first_name = (payload or {}).get("first_name")
    last_name = (payload or {}).get("last_name")
    if not phone:
        return JSONResponse(status_code=400, content={"error": "phone is required"})
    if not first_name or not last_name:
        return JSONResponse(status_code=400, content={"error": "first_name and last_name are required"})

    ensure_users_table(env)
    with psycopg2.connect(
        host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"], password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
    ) as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            # Check if user exists
            cur.execute("SELECT 1 FROM users WHERE phone = %s", (phone,))
            exists = cur.fetchone() is not None
            if exists:
                return JSONResponse(status_code=409, content={"error": "user_exists"})
            # Create new user
            cur.execute(
                "INSERT INTO users (phone, email, first_name, last_name) VALUES (%s, %s, %s, %s)",
                (phone, email, first_name, last_name),
            )

    code = _issue_otp(phone, env["OTP_TTL_SEC"], env)
    _enqueue_otp(phone, code, env)
    return JSONResponse(status_code=200, content={"status": "otp_sent"})


@router.post("/verify-otp")
def verify_otp(payload: dict = Body(...)):
    env = get_env()
    phone = _canonical_phone((payload or {}).get("phone"))
    code = (payload or {}).get("code")
    if not phone or not code:
        return JSONResponse(status_code=400, content={"error": "phone and code are required"})

    r = redis.Redis(host=env["REDIS_HOST"], port=env["REDIS_PORT"])
    data_raw = r.get(_otp_key(phone))
    if not data_raw:
        return JSONResponse(status_code=400, content={"error": "otp_expired_or_missing"})

    try:
        data = json.loads(data_raw)
    except Exception:
        return JSONResponse(status_code=400, content={"error": "otp_corrupted"})

    attempts_key = _otp_attempts_key(phone)
    attempts = int(r.get(attempts_key) or 0)
    if attempts >= 5:
        return JSONResponse(status_code=429, content={"error": "too_many_attempts"})

    if str(code) != str(data.get("code")):
        attempts += 1
        # preserve TTL using GETEX or by fetching TTL then setex
        ttl_attempts = r.ttl(attempts_key)
        ttl_otp = r.ttl(_otp_key(phone))
        ttl = ttl_attempts if ttl_attempts and ttl_attempts > 0 else ttl_otp
        if not ttl or ttl <= 0:
            ttl = env["OTP_TTL_SEC"]
        r.setex(attempts_key, ttl, attempts)
        return JSONResponse(status_code=400, content={"error": "invalid_code", "attempts": attempts})

    # success: fetch the user + status. A suspended account cannot obtain a token.
    user_id = None
    status = "active"
    with psycopg2.connect(
        host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"], password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
    ) as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SELECT id, COALESCE(status,'active') FROM users WHERE phone = %s", (phone,))
            row = cur.fetchone()
            if row:
                user_id = str(row[0])
                status = row[1]
            if status == "suspended":
                # Record the blocked attempt; do NOT issue a token.
                try:
                    cur.execute(
                        "INSERT INTO login_history (user_id, phone, success) VALUES (%s, %s, FALSE)",
                        (user_id, phone),
                    )
                except Exception:
                    pass
            else:
                cur.execute("UPDATE users SET is_verified = TRUE, last_login = NOW(), updated_at = NOW() WHERE phone = %s", (phone,))
                try:
                    cur.execute(
                        "INSERT INTO login_history (user_id, phone, success) VALUES (%s, %s, TRUE)",
                        (user_id, phone),
                    )
                except Exception:
                    pass

    r.delete(_otp_key(phone))
    r.delete(attempts_key)

    if status == "suspended":
        return JSONResponse(status_code=403, content={"error": "account_suspended"})

    # Issue JWT valid for configured duration; include user_id and sub (phone)
    jwt_payload = {"user_id": user_id, "sub": phone}
    token = create_jwt(jwt_payload, env["JWT_EXP_SECONDS"])
    return JSONResponse(status_code=200, content={"access_token": token})


@router.get("/me")
def get_current_user(authorization: str = Header(None)):
    env = get_env()
    
    # Extract token from Authorization header
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authorization header"
        )
    
    token = authorization.split(" ")[1]
    
    # Verify and decode token
    try:
        decoded = verify_jwt(token)
        user_id = decoded.get("user_id") or decoded.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token: missing user_id"
            )
        # Convert to string if needed
        user_id = str(user_id)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}"
        )
    
    ensure_users_table(env)
    
    with psycopg2.connect(
        host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"], password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
    ) as conn:
        with conn.cursor() as cur:
            # Try to find user by id (UUID format)
            # First try as UUID, then as string (phone)
            row = None
            try:
                import uuid
                user_uuid = uuid.UUID(user_id)
                # Search by UUID - convert to string for psycopg2
                cur.execute(
                    "SELECT id, phone, email, first_name, last_name, is_verified, created_at, updated_at, last_login, role FROM users WHERE id = %s",
                    (str(user_uuid),)
                )
                row = cur.fetchone()
            except ValueError:
                # If not a valid UUID, try to find by phone (sub might be phone)
                cur.execute(
                    "SELECT id, phone, email, first_name, last_name, is_verified, created_at, updated_at, last_login, role FROM users WHERE phone = %s",
                    (user_id,)
                )
                row = cur.fetchone()
            
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail=f"User not found: {user_id}"
                )
            
            # Combine first_name and last_name into full_name
            full_name = f"{row[3]} {row[4]}".strip() if row[3] and row[4] else (row[3] or row[4] or "")
            
            return JSONResponse(status_code=200, content={
                "id": str(row[0]),
                "_id": str(row[0]),
                "phone": row[1],
                "email": row[2] or "",
                "first_name": row[3],
                "last_name": row[4],
                "full_name": full_name,
                "name": full_name,
                "username": full_name,
                "is_verified": row[5],
                "created_at": row[6].isoformat() if row[6] else None,
                "updated_at": row[7].isoformat() if row[7] else None,
                "last_login": row[8].isoformat() if row[8] else None,
                "role": row[9] or "user",
            })


@router.post("/login")
def login(payload: dict = Body(...)):
    env = get_env()
    phone = _canonical_phone((payload or {}).get("phone"))
    if not phone:
        return JSONResponse(status_code=400, content={"error": "phone is required"})

    # Ensure users table exists (idempotent)
    ensure_users_table(env)

    # Ensure user exists
    with psycopg2.connect(
        host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"], password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
    ) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM users WHERE phone = %s", (phone,))
            exists = cur.fetchone() is not None
            if not exists:
                return JSONResponse(status_code=404, content={"error": "user_not_found"})

    code = _issue_otp(phone, env["OTP_TTL_SEC"], env)
    _enqueue_otp(phone, code, env)
    return JSONResponse(status_code=200, content={"status": "otp_sent"})
