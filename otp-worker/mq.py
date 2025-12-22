"""
RabbitMQ connection utilities for OTP Worker
"""

import logging
import os
import pika
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from pika.exceptions import AMQPConnectionError, StreamLostError, ConnectionClosedByBroker

logger = logging.getLogger(__name__)


def get_rabbit_params() -> pika.ConnectionParameters:
    """
    Get RabbitMQ connection parameters from environment variables.
    
    Returns:
        pika.ConnectionParameters object
    """
    host = os.getenv("RABBITMQ_HOST", "rabbitmq")
    port = int(os.getenv("RABBITMQ_PORT", "5672"))
    user = os.getenv("RABBITMQ_USER", "guest")
    password = os.getenv("RABBITMQ_PASSWORD", "guest")
    heartbeat = int(os.getenv("RABBITMQ_HEARTBEAT", "60"))
    blocked_timeout = float(os.getenv("RABBITMQ_BLOCKED_TIMEOUT", "300"))
    socket_timeout = float(os.getenv("RABBITMQ_SOCKET_TIMEOUT", "5"))
    
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
def connect_to_rabbitmq(params: pika.ConnectionParameters, queue_name: str):
    """
    Connect to RabbitMQ and declare queue.
    
    Args:
        params: RabbitMQ connection parameters
        queue_name: Name of the queue to declare
        
    Returns:
        Tuple of (connection, channel)
    """
    logger.info(f"Connecting to RabbitMQ at {params.host}:{params.port}")
    
    connection = pika.BlockingConnection(params)
    channel = connection.channel()
    
    # Declare queue as durable
    channel.queue_declare(queue=queue_name, durable=True)
    
    logger.info(f"Successfully connected to RabbitMQ and declared queue: {queue_name}")
    
    return connection, channel

