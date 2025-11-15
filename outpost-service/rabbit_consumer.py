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
# Redis removed - using Postgres messages_log instead

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

        # Redis removed - all message context is stored in Postgres messages_log table

    def _ensure_or_get_conversation(self, event_id: Optional[str], guest_phone: Optional[str], guest_id: Optional[str] = None, initial_state: str = "rsvp_invite") -> Optional[str]:
        """Ensure a Conversation exists for guest_phone + event_id. Returns conversation_id UUID."""
        if not self.pg_conn or not event_id or not guest_phone:
            return None
        
        # Validate event_id is a UUID (not wamid)
        try:
            import uuid
            uuid.UUID(event_id)  # Will raise ValueError if not a valid UUID
        except (ValueError, AttributeError):
            self.logger.debug(f"event_id is not a valid UUID, skipping conversation creation: {event_id}")
            return None
        
        try:
            with self.pg_conn.cursor() as cur:
                # Check if conversation exists
                cur.execute(
                    """
                    SELECT id FROM conversations
                    WHERE guest_phone = %s AND event_id = %s AND active = true
                    LIMIT 1
                    """,
                    (guest_phone, event_id),
                )
                row = cur.fetchone()
                if row:
                    return str(row[0])
                
                # Create new conversation
                cur.execute(
                    """
                    INSERT INTO conversations (guest_id, guest_phone, event_id, current_state, active)
                    VALUES (%s::uuid, %s, %s, %s, true)
                    RETURNING id
                    """,
                    (guest_id, guest_phone, event_id, initial_state),
                )
                row = cur.fetchone()
                if row:
                    self.logger.info(
                        f"Created new conversation for guest {guest_phone} and event {event_id} | conversation_id={row[0]}"
                    )
                    return str(row[0])
                return None
        except Exception as e:
            self.logger.warning(f"Failed to ensure/get conversation: {e}", exc_info=True)
            return None

    def _log_outgoing_whatsapp_id(self, conversation_id: Optional[str], message_type: str, state: Optional[str], whatsapp_message_id: str, payload: Optional[str] = None):
        """Log outgoing message to messages_log table with conversation_id."""
        if not self.pg_conn:
            return
        if not conversation_id:
            self.logger.debug("Skipping message log - no conversation_id provided")
            return
        try:
            with self.pg_conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO messages_log (conversation_id, wa_message_id, direction, message_type, payload, state, created_at)
                    VALUES (%s::uuid, %s, 'outgoing', %s, %s, %s, NOW())
                    """,
                    (conversation_id, whatsapp_message_id, message_type, payload, state)
                )
                self.logger.debug(
                    f"Logged outgoing message to messages_log",
                    extra={"conversation_id": conversation_id, "wa_message_id": whatsapp_message_id, "state": state}
                )
        except Exception as e:
            self.logger.warning(f"Failed to log WhatsApp message id: {e}", exc_info=True)

    # Redis removed - message context is stored in Postgres messages_log table
    # No need for separate Redis storage since all data is in messages_log with wa_message_id, state, conversation_id
    
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
                # Log basic AMQP delivery info
                try:
                    self.logger.info(
                        "Consumed message from outpost queue",
                        extra={
                            "routing_key": getattr(message, "routing_key", None),
                            "delivery_tag": getattr(message, "delivery_tag", None),
                            "headers": dict(getattr(message, "headers", {}) or {}),
                            "body_preview": message.body.decode(errors="ignore")[:500]
                        }
                    )
                except Exception:
                    pass

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
                    # Pre-send log
                    try:
                        self.logger.info(
                            "Sending WA template",
                            extra={
                                "recipient": message_data.get("recipient"),
                                "template": message_data.get("template"),
                                "parameters": message_data.get("parameters")
                            }
                        )
                    except Exception:
                        pass
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
                        if wa_id:
                            # Ensure conversation exists before logging
                            conversation_id = message_data.get("conversation_id")
                            if not conversation_id:
                                conversation_id = self._ensure_or_get_conversation(
                                    event_id=message_data.get("event_id"),
                                    guest_phone=message_data.get("recipient"),
                                    guest_id=message_data.get("guest_id"),
                                    initial_state=message_data.get("state", "rsvp_invite")
                                )
                            
                            state = message_data.get("state")
                            payload_json = json.dumps(message_data, ensure_ascii=False)[:4000]
                            self._log_outgoing_whatsapp_id(
                                conversation_id=conversation_id,
                                message_type="template",
                                state=state,
                                whatsapp_message_id=wa_id,
                                payload=payload_json,
                            )
                            # Message context is already stored in messages_log table above
                            # No need for separate Redis storage
                        
                        self.logger.info(
                            "Template message processed successfully",
                            extra={
                                "recipient": message_data["recipient"],
                                "template": message_data["template"],
                                "wa_message_id": (wa_resp or {}).get("messages", [{}])[0].get("id"),
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
                    # Pre-send log
                    try:
                        self.logger.info(
                            "Sending WA text",
                            extra={
                                "recipient": message_data.get("recipient"),
                                "text_len": len(message_data.get("text", ""))
                            }
                        )
                    except Exception:
                        pass
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
                        if wa_id:
                            # Ensure conversation exists before logging
                            conversation_id = message_data.get("conversation_id")
                            if not conversation_id:
                                conversation_id = self._ensure_or_get_conversation(
                                    event_id=message_data.get("event_id"),
                                    guest_phone=message_data.get("recipient"),
                                    guest_id=message_data.get("guest_id"),
                                    initial_state=message_data.get("state", "rsvp_invite")
                                )
                            
                            state = message_data.get("state")
                            payload_json = json.dumps(message_data, ensure_ascii=False)[:4000]
                            self._log_outgoing_whatsapp_id(
                                conversation_id=conversation_id,
                                message_type="free_text",
                                state=state,
                                whatsapp_message_id=wa_id,
                                payload=payload_json,
                            )
                            # Message context is already stored in messages_log table above
                            # No need for separate Redis storage
                        
                        self.logger.info(
                            "Free text message processed successfully",
                            extra={
                                "recipient": message_data["recipient"],
                                "text_length": len(message_data["text"]),
                                "wa_message_id": (wa_resp or {}).get("messages", [{}])[0].get("id"),
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
                    # Pre-send log
                    try:
                        self.logger.info(
                            "Sending WA interactive",
                            extra={
                                "recipient": message_data.get("recipient"),
                                "interactive_type": message_data.get("interactive", {}).get("type")
                            }
                        )
                    except Exception:
                        pass
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
                        if wa_id:
                            # Ensure conversation exists before logging
                            conversation_id = message_data.get("conversation_id")
                            if not conversation_id:
                                conversation_id = self._ensure_or_get_conversation(
                                    event_id=message_data.get("event_id"),
                                    guest_phone=message_data.get("recipient"),
                                    guest_id=message_data.get("guest_id"),
                                    initial_state=message_data.get("state", "rsvp_invite")
                                )
                            
                            state = message_data.get("state")
                            payload_json = json.dumps(message_data, ensure_ascii=False)[:4000]
                            self._log_outgoing_whatsapp_id(
                                conversation_id=conversation_id,
                                message_type="interactive",
                                state=state,
                                whatsapp_message_id=wa_id,
                                payload=payload_json,
                            )
                            # Message context is already stored in messages_log table above
                            # No need for separate Redis storage
                        
                        self.logger.info(
                            "Interactive message processed successfully",
                            extra={
                                "recipient": message_data["recipient"],
                                "interactive_type": message_data.get("interactive", {}).get("type"),
                                "button_count": len(message_data.get("interactive", {}).get("action", {}).get("buttons", [])),
                                "wa_message_id": (wa_resp or {}).get("messages", [{}])[0].get("id"),
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
