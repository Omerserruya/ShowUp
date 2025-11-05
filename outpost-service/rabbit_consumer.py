"""
RabbitMQ Consumer for Outpost Service

Handles RabbitMQ connection and message consumption using aio_pika.
"""

import asyncio
import json
import logging
import os
from typing import Dict, Any, Optional
from datetime import datetime, timezone

import aio_pika
import httpx
from aio_pika import Message, DeliveryMode
from aio_pika.abc import AbstractIncomingMessage
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from redis import asyncio as aioredis

from whatsapp_sender import WhatsAppSender
import psycopg2
from psycopg2.extras import RealDictCursor


class RabbitMQConsumer:
    """RabbitMQ consumer for processing outpost messages."""
    
    def __init__(self):
        self.logger = logging.getLogger("rabbit_consumer")
        self.connection = None
        self.channel = None
        self.queue = None
        self.whatsapp_sender = WhatsAppSender()
        self.running = False
        
        # RabbitMQ connection parameters
        self.host = os.getenv("RABBITMQ_HOST")  # Default to service name in Docker
        self.port = int(os.getenv("RABBITMQ_PORT"))
        self.user = os.getenv("RABBITMQ_USER")
        self.password = os.getenv("RABBITMQ_PASSWORD")
        self.queue_name = os.getenv("OUTPOST_QUEUE_NAME")

        # Postgres for logging WhatsApp message IDs (opt-in via OUTPOST_ENABLE_DB_LOGGING)
        enable_db_logging = (os.getenv('OUTPOST_ENABLE_DB_LOGGING', 'false').lower() == 'true')
        self.pg_conn = None
        self.db_url = None
        if enable_db_logging:
            db_user = os.getenv('DB_USER')
            db_password = os.getenv('DB_PASSWORD')
            db_host = os.getenv('DB_HOST')
            db_port = os.getenv('DB_PORT')
            db_name = os.getenv('DB_NAME')

            if all([db_user, db_password, db_host, db_port, db_name]):
                self.db_url = f"postgresql://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"
                try:
                    self.pg_conn = psycopg2.connect(self.db_url)
                    self.pg_conn.autocommit = True
                except Exception as e:
                    self.logger.warning(f"Outpost could not connect to Postgres for logging: {e}")
            else:
                self.logger.info("DB logging disabled: missing DB_* envs")

        # Redis for storing message context (same Redis as webhook-worker)
        self.redis = None
        self.message_context_ttl = int(os.getenv("MESSAGE_CONTEXT_TTL", "86400"))
        try:
            redis_url = os.getenv("REDIS_URL", "redis://redis:6379/0")
            self.redis = aioredis.from_url(
                redis_url,
                encoding="utf-8",
                decode_responses=True,
            )
        except Exception as e:
            self.logger.warning(f"Outpost could not connect to Redis for message context: {e}")

    def _log_outgoing_whatsapp_id(self, event_id: str, message_type: str, content: str, whatsapp_message_id: str):
        if not self.pg_conn:
            return
        try:
            with self.pg_conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO messages_log (guest_id, event_id, direction, type, content, state_before, state_after, whatsapp_message_id)
                    VALUES (NULL, %s, 'outgoing', %s, %s, NULL, %s, %s)
                    """,
                    (event_id, message_type, content, content, whatsapp_message_id)
                )
        except Exception as e:
            self.logger.warning(f"Failed to log WhatsApp message id: {e}")

    async def _store_message_context(self, message_id: str, state: str, event_id: str, guest_phone: str):
        """Store message context in Redis for reply resolution.
        
        This allows users to reply to old messages and resume the correct flow state.
        """
        if not self.redis:
            return
        
        if not message_id or not state or not event_id or not guest_phone:
            self.logger.debug("Skipping message context storage - missing required fields")
            return
        
        try:
            context = {
                "message_id": message_id,
                "state": state,
                "event_id": event_id,
                "guest_phone": guest_phone,
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            key = f"message_context:{message_id}"
            await self.redis.setex(
                key,
                self.message_context_ttl,
                json.dumps(context, ensure_ascii=False)
            )
            self.logger.debug(
                f"Stored message context for {message_id}",
                extra={"message_id": message_id, "state": state, "ttl": self.message_context_ttl}
            )
        except Exception as e:
            self.logger.warning(f"Failed to store message context: {e}")
    
    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        retry=retry_if_exception_type((aio_pika.exceptions.AMQPConnectionError, ConnectionError, OSError))
    )
    async def connect(self):
        """Establish connection to RabbitMQ with retry logic."""
        try:
            # Create connection URL
            connection_url = f"amqp://{self.user}:{self.password}@{self.host}:{self.port}/"
            
            self.logger.info(f"Connecting to RabbitMQ at {self.host}:{self.port}")
            
            # Create connection
            self.connection = await aio_pika.connect_robust(
                connection_url,
                heartbeat=60,
                blocked_connection_timeout=300
            )
            
            # Create channel
            self.channel = await self.connection.channel()
            
            # Set QoS to process one message at a time
            await self.channel.set_qos(prefetch_count=1)
            
            # Declare queue
            self.queue = await self.channel.declare_queue(
                self.queue_name,
                durable=True
            )
            
            self.logger.info(f"Connected to RabbitMQ, listening on queue: {self.queue_name}")
            
        except Exception as e:
            self.logger.error(f"Failed to connect to RabbitMQ: {e}")
            raise
    
    async def process_message(self, message: AbstractIncomingMessage):
        """Process a single message from the queue."""
        async with message.process():
            try:
                # Parse message body
                message_data = json.loads(message.body.decode())
                
                self.logger.info(
                    "Processing outpost message",
                    extra={
                        "platform": message_data.get("platform"),
                        "recipient": message_data.get("recipient"),
                        "template": message_data.get("template")
                    }
                )
                
                # Only process WhatsApp messages
                if message_data.get("platform") != "WA":
                    self.logger.warning(
                        f"Unsupported platform: {message_data.get('platform')}, skipping",
                        extra={"platform": message_data.get("platform")}
                    )
                    return
                
                # Determine message type and validate accordingly
                message_type = message_data.get("message_type", "template")
                
                if message_type == "template":
                    # Validate template message format
                    required_fields = ["platform", "recipient", "template", "parameters"]
                    missing_fields = [field for field in required_fields if field not in message_data]
                    
                    if missing_fields:
                        self.logger.error(
                            f"Invalid template message format, missing fields: {missing_fields}",
                            extra={"message_data": message_data}
                        )
                        return
                    
                    # Send template message
                    try:
                        wa_resp = await self.whatsapp_sender.send_template_message(
                            recipient=message_data["recipient"],
                            template_name=message_data["template"],
                            parameters=message_data["parameters"]
                        )
                        # Log full WhatsApp API response (truncated)
                        try:
                            self.logger.info(
                                "WA response (template)",
                                extra={
                                    "recipient": message_data.get("recipient"),
                                    "template": message_data.get("template"),
                                    "wa_response": wa_resp
                                }
                            )
                        except Exception:
                            pass
                        wa_id = (wa_resp or {}).get("messages", [{}])[0].get("id")
                        if wa_id and message_data.get("event_id"):
                            self._log_outgoing_whatsapp_id(
                                event_id=str(message_data.get("event_id")),
                                message_type="template",
                                content=str(message_data.get("state") or message_data.get("template")),
                                whatsapp_message_id=wa_id,
                            )
                            # Store message context for reply resolution
                            if message_data.get("state") and message_data.get("recipient"):
                                await self._store_message_context(
                                    message_id=wa_id,
                                    state=str(message_data.get("state")),
                                    event_id=str(message_data.get("event_id")),
                                    guest_phone=str(message_data.get("recipient"))
                                )
                        
                        self.logger.info(
                            "Template message processed successfully",
                            extra={
                                "recipient": message_data["recipient"],
                                "template": message_data["template"],
                                "source": message_data.get("source", "unknown")
                            }
                        )
                    except httpx.HTTPStatusError as e:
                        self.logger.error(
                            "WhatsApp API error - template message not sent",
                            extra={
                                "recipient": message_data.get("recipient"),
                                "template": message_data.get("template"),
                                "status_code": e.response.status_code,
                                "error": str(e)
                            }
                        )
                    except Exception as e:
                        self.logger.error(
                            f"Unexpected error sending template message: {str(e)}",
                            extra={
                                "recipient": message_data.get("recipient"),
                                "template": message_data.get("template"),
                                "error": str(e),
                                "error_type": type(e).__name__
                            },
                            exc_info=True
                        )
                        
                elif message_type == "free_text":
                    # Validate free text message format
                    required_fields = ["platform", "recipient", "text"]
                    missing_fields = [field for field in required_fields if field not in message_data]
                    
                    if missing_fields:
                        self.logger.error(
                            f"Invalid free text message format, missing fields: {missing_fields}",
                            extra={"message_data": message_data}
                        )
                        return
                    
                    # Send text message
                    try:
                        wa_resp = await self.whatsapp_sender.send_text_message(
                            recipient=message_data["recipient"],
                            text=message_data["text"]
                        )
                        # Log full WhatsApp API response (truncated)
                        try:
                            self.logger.info(
                                "WA response (text)",
                                extra={
                                    "recipient": message_data.get("recipient"),
                                    "text_len": len(message_data.get("text", "")),
                                    "wa_response": wa_resp
                                }
                            )
                        except Exception:
                            pass
                        wa_id = (wa_resp or {}).get("messages", [{}])[0].get("id")
                        if wa_id and message_data.get("event_id"):
                            self._log_outgoing_whatsapp_id(
                                event_id=str(message_data.get("event_id")),
                                message_type="free_text",
                                content=str(message_data.get("state") or message_data.get("text") or "free_text"),
                                whatsapp_message_id=wa_id,
                            )
                            # Store message context for reply resolution
                            if message_data.get("state") and message_data.get("recipient"):
                                await self._store_message_context(
                                    message_id=wa_id,
                                    state=str(message_data.get("state")),
                                    event_id=str(message_data.get("event_id")),
                                    guest_phone=str(message_data.get("recipient"))
                                )
                        
                        self.logger.info(
                            "Free text message processed successfully",
                            extra={
                                "recipient": message_data["recipient"],
                                "text_length": len(message_data["text"]),
                                "source": message_data.get("source", "unknown"),
                                "original_type": message_data.get("original_type", "unknown")
                            }
                        )
                    except httpx.HTTPStatusError as e:
                        self.logger.error(
                            "WhatsApp API error - free text message not sent",
                            extra={
                                "recipient": message_data.get("recipient"),
                                "text_length": len(message_data.get("text", "")),
                                "status_code": e.response.status_code,
                                "error": str(e)
                            }
                        )
                    except Exception as e:
                        self.logger.error(
                            f"Unexpected error sending free text message: {str(e)}",
                            extra={
                                "recipient": message_data.get("recipient"),
                                "text_length": len(message_data.get("text", "")),
                                "error": str(e),
                                "error_type": type(e).__name__
                            },
                            exc_info=True
                        )
                        
                elif message_type == "interactive":
                    # Validate interactive message format
                    required_fields = ["platform", "recipient", "interactive"]
                    missing_fields = [field for field in required_fields if field not in message_data]
                    
                    if missing_fields:
                        self.logger.error(
                            f"Invalid interactive message format, missing fields: {missing_fields}",
                            extra={"message_data": message_data}
                        )
                        return
                    
                    # Send interactive message
                    try:
                        wa_resp = await self.whatsapp_sender.send_interactive_message(
                            recipient=message_data["recipient"],
                            interactive=message_data["interactive"]
                        )
                        # Log full WhatsApp API response (truncated)
                        try:
                            self.logger.info(
                                "WA response (interactive)",
                                extra={
                                    "recipient": message_data.get("recipient"),
                                    "interactive_type": message_data.get("interactive", {}).get("type"),
                                    "wa_response": wa_resp
                                }
                            )
                        except Exception:
                            pass
                        wa_id = (wa_resp or {}).get("messages", [{}])[0].get("id")
                        if wa_id and message_data.get("event_id"):
                            self._log_outgoing_whatsapp_id(
                                event_id=str(message_data.get("event_id")),
                                message_type="interactive",
                                content=str(message_data.get("state") or "interactive"),
                                whatsapp_message_id=wa_id,
                            )
                            # Store message context for reply resolution
                            if message_data.get("state") and message_data.get("recipient"):
                                await self._store_message_context(
                                    message_id=wa_id,
                                    state=str(message_data.get("state")),
                                    event_id=str(message_data.get("event_id")),
                                    guest_phone=str(message_data.get("recipient"))
                                )
                        
                        self.logger.info(
                            "Interactive message processed successfully",
                            extra={
                                "recipient": message_data["recipient"],
                                "interactive_type": message_data.get("interactive", {}).get("type"),
                                "button_count": len(message_data.get("interactive", {}).get("action", {}).get("buttons", [])),
                                "source": message_data.get("source", "unknown")
                            }
                        )
                    except httpx.HTTPStatusError as e:
                        self.logger.error(
                            "WhatsApp API error - interactive message not sent",
                            extra={
                                "recipient": message_data.get("recipient"),
                                "interactive_type": message_data.get("interactive", {}).get("type"),
                                "status_code": e.response.status_code,
                                "error": str(e)
                            }
                        )
                    except Exception as e:
                        self.logger.error(
                            f"Unexpected error sending interactive message: {str(e)}",
                            extra={
                                "recipient": message_data.get("recipient"),
                                "interactive_type": message_data.get("interactive", {}).get("type"),
                                "error": str(e),
                                "error_type": type(e).__name__
                            },
                            exc_info=True
                        )
                        
                else:
                    self.logger.error(
                        f"Unknown message type: {message_type}",
                        extra={"message_data": message_data}
                    )
                    return
                
            except json.JSONDecodeError as e:
                self.logger.error(f"Failed to parse message JSON: {e}")
            except Exception as e:
                self.logger.error(
                    f"Failed to process message: {e}",
                    extra={"message_body": message.body.decode()[:500]}
                )
                # Re-raise to trigger retry mechanism
                raise
    
    async def start_consuming(self):
        """Start consuming messages from the queue."""
        if not self.connection or not self.channel:
            await self.connect()
        
        self.running = True
        
        # Start consuming
        await self.queue.consume(self.process_message)
        
        self.logger.info("Started consuming messages from outpost_queue")
        
        # Keep the consumer running
        try:
            while self.running:
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            self.logger.info("Consumer cancelled")
        except Exception as e:
            self.logger.error(f"Consumer error: {e}")
            raise
    
    async def stop(self):
        """Stop consuming messages."""
        self.logger.info("Stopping message consumption...")
        self.running = False
    
    async def close(self):
        """Close RabbitMQ connection."""
        if self.channel and not self.channel.is_closed:
            await self.channel.close()
        
        if self.connection and not self.connection.is_closed:
            await self.connection.close()
        
        self.logger.info("RabbitMQ connection closed")
