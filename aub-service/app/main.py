import os
import json
import pika
import psycopg2
import redis
from fastapi import FastAPI, Body, Header, HTTPException
from fastapi.responses import JSONResponse
from fastapi import status
from .token_utils import create_jwt, verify_jwt


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
        "REDIS_HOST": os.getenv("REDIS_HOST"),
        "REDIS_PORT": int(os.getenv("REDIS_PORT")),
        "OTP_TTL_SEC": int(os.getenv("OTP_TTL_SEC")),
        "JWT_EXP_SECONDS": int(os.getenv("JWT_EXP_SECONDS")),
    }


app = FastAPI(title="AUB Service")


def check_db_connection(env):
    try:
        conn = psycopg2.connect(
            host=env["DB_HOST"],
            port=env["DB_PORT"],
            user=env["DB_USER"],
            password=env["DB_PASSWORD"],
            dbname=env["DB_NAME"],
            connect_timeout=3,
        )
        conn.close()
        return True
    except Exception:
        return False


def check_rabbit_connection(env):
    try:
        params = pika.ConnectionParameters(
            host=env["RABBITMQ_HOST"],
            port=env["RABBITMQ_PORT"],
            credentials=pika.PlainCredentials(env["RABBITMQ_USER"], env["RABBITMQ_PASSWORD"]),
            connection_attempts=1,
            socket_timeout=3,
        )
        connection = pika.BlockingConnection(params)
        connection.close()
        return True
    except Exception:
        return False


def check_redis_connection(env):
    try:
        r = redis.Redis(host=env["REDIS_HOST"], port=env["REDIS_PORT"], socket_connect_timeout=2)
        r.ping()
        return True
    except Exception:
        return False


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
        "updated_at TIMESTAMP NOT NULL DEFAULT NOW()"
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


@app.get("/health")
def health():
    env = get_env()
    # Ensure users table exists on startup/health-check so the schema is always ready
    try:
        ensure_users_table(env)
        users_table_ok = True
    except Exception:
        users_table_ok = False

    db_ok = check_db_connection(env) and users_table_ok
    rabbit_ok = check_rabbit_connection(env)
    redis_ok = check_redis_connection(env)
    status_code = 200 if (db_ok and rabbit_ok and redis_ok) else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "db": db_ok,
            "users_table": users_table_ok,
            "rabbit": rabbit_ok,
            "redis": redis_ok,
        },
    )


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


@app.post("/register")
def register(payload: dict = Body(...)):
    env = get_env()
    phone = (payload or {}).get("phone")
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


@app.post("/verify-otp")
def verify_otp(payload: dict = Body(...)):
    env = get_env()
    phone = (payload or {}).get("phone")
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

    # success: mark user verified and fetch user_id, then cleanup keys
    user_id = None
    with psycopg2.connect(
        host=env["DB_HOST"], port=env["DB_PORT"], user=env["DB_USER"], password=env["DB_PASSWORD"], dbname=env["DB_NAME"],
    ) as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("UPDATE users SET is_verified = TRUE, last_login = NOW(), updated_at = NOW() WHERE phone = %s", (phone,))
            cur.execute("SELECT id FROM users WHERE phone = %s", (phone,))
            row = cur.fetchone()
            if row:
                user_id = str(row[0])

    r.delete(_otp_key(phone))
    r.delete(attempts_key)

    # Issue JWT valid for configured duration; include user_id and sub (phone)
    jwt_payload = {"user_id": user_id, "sub": phone}
    token = create_jwt(jwt_payload, env["JWT_EXP_SECONDS"])
    return JSONResponse(status_code=200, content={"access_token": token})


@app.get("/me")
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
                    "SELECT id, phone, email, first_name, last_name, is_verified, created_at, updated_at, last_login FROM users WHERE id = %s",
                    (str(user_uuid),)
                )
                row = cur.fetchone()
            except ValueError:
                # If not a valid UUID, try to find by phone (sub might be phone)
                cur.execute(
                    "SELECT id, phone, email, first_name, last_name, is_verified, created_at, updated_at, last_login FROM users WHERE phone = %s",
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
            })


@app.post("/login")
def login(payload: dict = Body(...)):
    env = get_env()
    phone = (payload or {}).get("phone")
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



