import os
import json
import logging
import pika
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


def get_rabbit_params() -> pika.ConnectionParameters:
    host = os.getenv("RABBITMQ_HOST", "rabbitmq")
    port = int(os.getenv("RABBITMQ_PORT", "5672"))
    user = os.getenv("RABBITMQ_USER", "guest")
    password = os.getenv("RABBITMQ_PASSWORD", "guest")
    heartbeat = int(os.getenv("RABBITMQ_HEARTBEAT", "30"))
    blocked_timeout = float(os.getenv("RABBITMQ_BLOCKED_TIMEOUT", "30"))
    return pika.ConnectionParameters(
        host=host,
        port=port,
        heartbeat=heartbeat,
        blocked_connection_timeout=blocked_timeout,
        credentials=pika.PlainCredentials(user, password),
    )


@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=1, min=1, max=30))
def connect() -> pika.BlockingConnection:
    logger.info("Connecting to RabbitMQ...")
    return pika.BlockingConnection(get_rabbit_params())


def publish_campaign(channel: pika.adapters.blocking_connection.BlockingChannel, queue_name: str, message: dict):
    channel.queue_declare(queue=queue_name, durable=True)
    body = json.dumps(message).encode("utf-8")
    channel.basic_publish(exchange="", routing_key=queue_name, body=body, properties=pika.BasicProperties(delivery_mode=2))


def ensure_channel(conn: pika.BlockingConnection, channel: pika.adapters.blocking_connection.BlockingChannel | None) -> pika.adapters.blocking_connection.BlockingChannel:
    if channel is None or channel.is_closed:
        return conn.channel()
    return channel


