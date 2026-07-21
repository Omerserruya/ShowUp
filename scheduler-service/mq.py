import os
import json
import logging
import time
import pika
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from pika.exceptions import AMQPConnectionError, StreamLostError, ConnectionClosedByBroker

logger = logging.getLogger(__name__)


def get_rabbit_params() -> pika.ConnectionParameters:
    host = os.getenv("RABBITMQ_HOST", "rabbitmq")
    port = int(os.getenv("RABBITMQ_PORT", "5672"))
    user = os.getenv("RABBITMQ_USER", "guest")
    password = os.getenv("RABBITMQ_PASSWORD", "guest")
    heartbeat = int(os.getenv("RABBITMQ_HEARTBEAT", "60"))  # Increased from 30 to 60
    blocked_timeout = float(os.getenv("RABBITMQ_BLOCKED_TIMEOUT", "300"))  # Increased from 30 to 300
    socket_timeout = float(os.getenv("RABBITMQ_SOCKET_TIMEOUT", "5"))  # Socket timeout
    return pika.ConnectionParameters(
        host=host,
        port=port,
        heartbeat=heartbeat,
        blocked_connection_timeout=blocked_timeout,
        socket_timeout=socket_timeout,
        connection_attempts=3,
        retry_delay=1,
        credentials=pika.PlainCredentials(user, password),
    )


@retry(
    stop=stop_after_attempt(10), 
    wait=wait_exponential(multiplier=1, min=2, max=60),
    retry=retry_if_exception_type((AMQPConnectionError, StreamLostError, ConnectionClosedByBroker, ConnectionResetError))
)
def connect() -> pika.BlockingConnection:
    logger.info("Connecting to RabbitMQ...")
    try:
        connection = pika.BlockingConnection(get_rabbit_params())
        logger.info("Successfully connected to RabbitMQ")
        return connection
    except Exception as e:
        logger.error(f"Failed to connect to RabbitMQ: {e}")
        raise


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type((AMQPConnectionError, StreamLostError, ConnectionClosedByBroker, ConnectionResetError))
)
def publish_campaign(channel: pika.adapters.blocking_connection.BlockingChannel, queue_name: str, message: dict):
    try:
        channel.queue_declare(queue=queue_name, durable=True)
        _inject_correlation(message)
        body = json.dumps(message).encode("utf-8")
        channel.basic_publish(exchange="", routing_key=queue_name, body=body, properties=pika.BasicProperties(delivery_mode=2))
    except Exception as e:
        logger.error(f"Failed to publish message to {queue_name}: {e}")
        raise


def ensure_channel(conn: pika.BlockingConnection, channel: pika.adapters.blocking_connection.BlockingChannel | None) -> pika.adapters.blocking_connection.BlockingChannel:
    if channel is None or channel.is_closed:
        logger.info("Creating new RabbitMQ channel")
        return conn.channel()
    return channel


def is_connection_healthy(conn: pika.BlockingConnection) -> bool:
    """Check if RabbitMQ connection is healthy"""
    try:
        return conn is not None and not conn.is_closed
    except Exception:
        return False


def reconnect_rabbitmq() -> tuple[pika.BlockingConnection, pika.adapters.blocking_connection.BlockingChannel]:
    """Reconnect to RabbitMQ and return new connection and channel"""
    logger.info("Reconnecting to RabbitMQ...")
    conn = connect()
    channel = conn.channel()
    logger.info("Successfully reconnected to RabbitMQ")
    return conn, channel


def send_heartbeat(conn: pika.BlockingConnection) -> bool:
    """Send a heartbeat to keep connection alive"""
    try:
        if conn and not conn.is_closed:
            # Simple heartbeat by checking connection state
            conn.process_data_events(time_limit=0)
            return True
    except Exception as e:
        logger.warning(f"Heartbeat failed: {e}")
    return False


def _inject_correlation(message: dict) -> None:
    """Stamp the current correlation id onto an outgoing message (best-effort)."""
    try:
        from shared.obs import inject_into
        inject_into(message)
    except Exception:
        pass
