"""
RabbitMQ utilities for the assistant worker.
"""

import json
import logging
import os

import pika
from pika.exceptions import AMQPConnectionError, ConnectionClosedByBroker, StreamLostError
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


def get_params() -> pika.ConnectionParameters:
    host = os.getenv("RABBITMQ_HOST")
    port = int(os.getenv("RABBITMQ_PORT"))
    user = os.getenv("RABBITMQ_USER")
    password = os.getenv("RABBITMQ_PASSWORD")
    heartbeat = int(os.getenv("RABBITMQ_HEARTBEAT", "60"))
    blocked_timeout = float(os.getenv("RABBITMQ_BLOCKED_TIMEOUT", "300"))
    return pika.ConnectionParameters(
        host=host,
        port=port,
        heartbeat=heartbeat,
        blocked_connection_timeout=blocked_timeout,
        credentials=pika.PlainCredentials(user, password),
    )


@retry(
    stop=stop_after_attempt(10),
    wait=wait_exponential(multiplier=1, min=2, max=60),
    retry=retry_if_exception_type((AMQPConnectionError, StreamLostError, ConnectionClosedByBroker, ConnectionResetError)),
)
def connect() -> pika.BlockingConnection:
    logger.info("Connecting to RabbitMQ...")
    return pika.BlockingConnection(get_params())


def publish(channel, queue_name: str, message: dict):
    channel.queue_declare(queue=queue_name, durable=True)
    _inject_correlation(message)
    body = json.dumps(message, ensure_ascii=False).encode("utf-8")
    headers = {"message_type": message.get("message_type", "text")}
    channel.basic_publish(
        exchange="",
        routing_key=queue_name,
        body=body,
        properties=pika.BasicProperties(delivery_mode=2, headers=headers),
    )


def _inject_correlation(message: dict) -> None:
    """Stamp the current correlation id onto an outgoing message (best-effort)."""
    try:
        from shared.obs import inject_into
        inject_into(message)
    except Exception:
        pass
