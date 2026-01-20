import os
import psycopg2
import pika
import redis
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from .mongodb import check_mongodb_connection
from .routers import plans, auth, orders


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

# Include routers
app.include_router(auth.router)
app.include_router(plans.router)
app.include_router(orders.router)


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


@app.get("/health")
def health():
    env = get_env()
    # Import ensure_users_table from auth router for health check
    from .routers.auth import ensure_users_table
    
    # Ensure users table exists on startup/health-check so the schema is always ready
    try:
        ensure_users_table(env)
        users_table_ok = True
    except Exception:
        users_table_ok = False

    db_ok = check_db_connection(env) and users_table_ok
    rabbit_ok = check_rabbit_connection(env)
    redis_ok = check_redis_connection(env)
    mongo_ok = check_mongodb_connection()
    status_code = 200 if (db_ok and rabbit_ok and redis_ok and mongo_ok) else 503
    return JSONResponse(
        status_code=status_code,
        content={
            "db": db_ok,
            "users_table": users_table_ok,
            "rabbit": rabbit_ok,
            "redis": redis_ok,
            "mongodb": mongo_ok,
        },
    )



