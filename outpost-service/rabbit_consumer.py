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
from db_utils import get_conversation_db


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

        # Database utilities for conversation management and message logging
        self.conversation_db = get_conversation_db()
    
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
                                self.logger.info(
                                    "No conversation_id in message, creating/retrieving conversation",
                                    extra={
                                        "event_id": message_data.get("event_id"),
                                        "recipient": message_data.get("recipient"),
                                        "guest_id": message_data.get("guest_id"),
                                        "state": message_data.get("state", "rsvp_invite")
                                    }
                                )
                                # Always use "rsvp_invite" as initial state for new conversations
                                # The "state" field in message_data is the template name, not the conversation state
                                conversation_id = self.conversation_db.ensure_or_get_conversation(
                                    event_id=message_data.get("event_id"),
                                    guest_phone=message_data.get("recipient"),
                                    guest_id=message_data.get("guest_id"),
                                    initial_state="rsvp_invite"
                                )
                                if conversation_id:
                                    self.logger.info(
                                        "Conversation created/retrieved",
                                        extra={"conversation_id": conversation_id}
                                    )
                                else:
                                    self.logger.warning(
                                        "Failed to create/retrieve conversation, will not log to messages_log",
                                        extra={
                                            "event_id": message_data.get("event_id"),
                                            "recipient": message_data.get("recipient")
                                        }
                                    )
                            
                            if conversation_id:
                                # Get the actual conversation state from the database
                                # For template messages (campaigns), the state should be "rsvp_invite"
                                # The "state" field in message_data is the template name, not the conversation state
                                actual_state = self.conversation_db.get_conversation_state(conversation_id) or "rsvp_invite"
                                payload_json = json.dumps(message_data, ensure_ascii=False)[:4000]
                                self.conversation_db.log_outgoing_message(
                                    conversation_id=conversation_id,
                                    message_type="template",
                                    state=actual_state,
                                    whatsapp_message_id=wa_id,
                                    payload=payload_json,
                                )
                                self.logger.info(
                                    "Logged outgoing template message to messages_log",
                                    extra={
                                        "conversation_id": conversation_id,
                                        "wa_message_id": wa_id,
                                        "state": actual_state
                                    }
                                )
                            else:
                                self.logger.warning(
                                    "Cannot log message to messages_log - no conversation_id",
                                    extra={"wa_message_id": wa_id}
                                )
                            # Message context is already stored in messages_log table above
                            # No need for separate Redis storage
                        else:
                            self.logger.warning(
                                "No WhatsApp message ID in response, cannot log to messages_log",
                                extra={"wa_response": wa_resp}
                            )
                        
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
                                # Always use "rsvp_invite" as initial state for new conversations
                                # The "state" field in message_data is the template name, not the conversation state
                                conversation_id = self.conversation_db.ensure_or_get_conversation(
                                    event_id=message_data.get("event_id"),
                                    guest_phone=message_data.get("recipient"),
                                    guest_id=message_data.get("guest_id"),
                                    initial_state="rsvp_invite"
                                )
                            
                            if conversation_id:
                                # Get the actual conversation state from the database
                                actual_state = self.conversation_db.get_conversation_state(conversation_id) or message_data.get("state", "rsvp_invite")
                                payload_json = json.dumps(message_data, ensure_ascii=False)[:4000]
                                self.conversation_db.log_outgoing_message(
                                    conversation_id=conversation_id,
                                    message_type="free_text",
                                    state=actual_state,
                                    whatsapp_message_id=wa_id,
                                    payload=payload_json,
                                )
                            else:
                                self.logger.warning(
                                    "Cannot log free_text message to messages_log - no conversation_id",
                                    extra={"wa_message_id": wa_id}
                                )
                            # Message context is already stored in messages_log table above
                            # No need for separate Redis storage
                        else:
                            self.logger.warning(
                                "No WhatsApp message ID in response, cannot log to messages_log",
                                extra={"wa_response": wa_resp}
                            )
                        
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
                                # Always use "rsvp_invite" as initial state for new conversations
                                # The "state" field in message_data is the template name, not the conversation state
                                conversation_id = self.conversation_db.ensure_or_get_conversation(
                                    event_id=message_data.get("event_id"),
                                    guest_phone=message_data.get("recipient"),
                                    guest_id=message_data.get("guest_id"),
                                    initial_state="rsvp_invite"
                                )
                            
                            if conversation_id:
                                # Get the actual conversation state from the database
                                actual_state = self.conversation_db.get_conversation_state(conversation_id) or message_data.get("state", "rsvp_invite")
                                payload_json = json.dumps(message_data, ensure_ascii=False)[:4000]
                                self.conversation_db.log_outgoing_message(
                                    conversation_id=conversation_id,
                                    message_type="interactive",
                                    state=actual_state,
                                    whatsapp_message_id=wa_id,
                                    payload=payload_json,
                                )
                            else:
                                self.logger.warning(
                                    "Cannot log interactive message to messages_log - no conversation_id",
                                    extra={"wa_message_id": wa_id}
                                )
                            # Message context is already stored in messages_log table above
                            # No need for separate Redis storage
                        else:
                            self.logger.warning(
                                "No WhatsApp message ID in response, cannot log to messages_log",
                                extra={"wa_response": wa_resp}
                            )
                        
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
