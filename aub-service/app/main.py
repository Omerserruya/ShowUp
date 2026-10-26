import os
import time
import psycopg2
import pika
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from .routers import plans, auth, orders, admin as admin_router


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
        "REDIS_URL": os.getenv("REDIS_URL"),
        "REDIS_PASSWORD": os.getenv("REDIS_PASSWORD") or None,
        "OTP_TTL_SEC": int(os.getenv("OTP_TTL_SEC")),
        "JWT_EXP_SECONDS": int(os.getenv("JWT_EXP_SECONDS")),
    }


app = FastAPI(title="AUB Service")


@app.on_event("startup")
def _start_heartbeat():
    try:
        from shared.obs import bootstrap
        bootstrap("aub")
    except Exception:
        pass


@app.on_event("startup")
def _ensure_schema():
    """Create the users/login_history schema ONCE per process (request handlers
    no longer run DDL). Retries briefly in case Postgres is still warming up;
    never blocks startup - ensure_users_table() is memoized and /health retries it."""
    env = get_env()
    for attempt in range(5):
        try:
            auth.ensure_users_table(env)
            return
        except Exception as exc:
            print(f"[AUB] users schema init failed (attempt {attempt + 1}/5): {exc}")
            time.sleep(2)


try:
    from shared.obs.fastapi import install_fastapi_observability
    install_fastapi_observability(app)
except Exception:
    pass


# Include routers
app.include_router(auth.router)
app.include_router(plans.router)
app.include_router(orders.router)
app.include_router(admin_router.router)


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
        auth.get_redis(env).ping()
        return True
    except Exception:
        return False


@app.get("/healthz")
def healthz():
    """Cheap liveness probe for the container healthcheck (no DB/broker I/O)."""
    return {"status": "ok"}


@app.get("/health")
def health():
    env = get_env()
    from .routers.auth import ensure_users_table

    # Memoized: a no-op once the startup init succeeded; self-heals otherwise.
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



