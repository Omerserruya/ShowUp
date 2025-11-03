import asyncio
import json
import logging
import os
from typing import Dict, Any, List
from datetime import datetime
import aio_pika
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from flow_manager import ConversationFlowManager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

class WebhookWorker:
    def __init__(self):
        # RabbitMQ connection parameters
        self.host = os.getenv("RABBITMQ_HOST")
        self.port = int(os.getenv("RABBITMQ_PORT"))
        self.user = os.getenv("RABBITMQ_USER")
        self.password = os.getenv("RABBITMQ_PASSWORD")
        self.webhook_queue = os.getenv("WEBHOOK_QUEUE")
        self.outpost_queue = os.getenv("OUTPOST_QUEUE")
        
        self.connection = None
        self.channel = None
        self.flow_manager = ConversationFlowManager()
    
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
            
            self.connection = await aio_pika.connect_robust(connection_url)
            self.channel = await self.connection.channel()
            
            # Set QoS to process one message at a time
            await self.channel.set_qos(prefetch_count=1)
            
            logger.info(f"Connected to RabbitMQ at {self.host}:{self.port}")
            
        except Exception as e:
            logger.error(f"Failed to connect to RabbitMQ: {e}")
            raise

    async def process_contacts(self, message_data: Dict[str, Any]) -> Dict[str, Any]:
        """Process contact messages - create summary and send to outpost queue"""
        try:
            payload = message_data.get("payload", {})
            extracted_data = payload.get("extracted_data", {})
            contact = extracted_data.get("contact", {})
            
            # Extract contact information
            name = contact.get("name", "Unknown")
            phones = contact.get("phones", [])
            
            # Create summary text
            phone_text = ", ".join(phones) if phones else "No phone"
            summary_text = f"Contact shared: {name} - {phone_text}"
            
            # Prepare message for outpost queue
            outpost_message = {
                "platform": "WA",  # Add platform field
                "recipient": message_data.get("recipient"),
                "message_id": message_data.get("message_id"),
                "text": summary_text,
                "message_type": "free_text",  # Contact summaries are free text
                "template_id": None,
                "template_params": None,
                "processed_at": datetime.utcnow().isoformat(),
                "source": "webhook_worker",
                "original_type": "contacts"
            }
            
            logger.info(f"Processed contact: {name} - {phone_text}")
            return outpost_message
            
        except Exception as e:
            logger.error(f"Error processing contact: {e}")
            raise

    async def process_message(self, message_data: Dict[str, Any]) -> Dict[str, Any]:
        """Process free text via conversation flow manager -> produce template to send."""
        try:
            payload = message_data.get("payload", {})
            extracted = payload.get("extracted_data", {})
            text_body = extracted.get("text", "")
            guest_phone = message_data.get("recipient")
            event_id = (payload.get("event_id") or message_data.get("event_id") or "")
            message_id = message_data.get("message_id")
            reply_to_message_id = message_data.get("reply_to_message_id") or (payload.get("context") or {}).get("id")
            button_id_hint = extracted.get("button_id")

            outpost_message, prev_state, next_state = await self.flow_manager.handle_incoming(
                msg_type="free_text",
                guest_phone=guest_phone,
                text=text_body,
                event_id=event_id if event_id and not event_id.startswith("wamid.") else None,  # Skip WhatsApp message IDs
                message_id=message_id,
                reply_to_message_id=reply_to_message_id,
                button_id=button_id_hint,
                template_parameters=payload.get("template_parameters") or {},
                guest={"phone": guest_phone},
                event={"id": event_id if event_id and not event_id.startswith("wamid.") else None}
            )

            if outpost_message is None:
                logger.warning(
                    f"Skipping message processing for {guest_phone} - no event found",
                    extra={"guest": guest_phone, "message_id": message_id}
                )
                return None
            
            logger.info(
                f"Flow transition (free_text): {prev_state} -> {next_state}",
                extra={"guest": guest_phone}
            )
            return outpost_message
            
        except Exception as e:
            logger.error(f"Error processing message: {e}")
            raise

    async def process_quick_reply(self, message_data: Dict[str, Any]) -> Dict[str, Any]:
        """Process quick_reply via conversation flow manager -> produce template to send."""
        try:
            payload = message_data.get("payload", {})
            extracted = payload.get("extracted_data", {})
            # Extract button text - try title first, then text, then id
            # Also log what we're extracting for debugging
            button_title = extracted.get("button_title") or ""
            button_text = extracted.get("button_text") or ""
            button_id = extracted.get("button_id") or ""
            
            selection_text = button_title or button_text or button_id
            
            logger.info(
                f"Extracting quick_reply data",
                extra={
                    "button_title": button_title,
                    "button_text": button_text,
                    "button_id": button_id,
                    "selected_text": selection_text,
                    "extracted_data": extracted
                }
            )
            guest_phone = message_data.get("recipient")
            event_id = (payload.get("event_id") or message_data.get("event_id") or "")
            message_id = message_data.get("message_id")
            reply_to_message_id = message_data.get("reply_to_message_id") or (payload.get("context") or {}).get("id")

            outpost_message, prev_state, next_state = await self.flow_manager.handle_incoming(
                msg_type="quick_reply",
                guest_phone=guest_phone,
                text=selection_text,
                event_id=event_id if event_id and not event_id.startswith("wamid.") else None,  # Skip WhatsApp message IDs
                message_id=message_id,
                reply_to_message_id=reply_to_message_id,
                button_id=button_id,
                template_parameters=payload.get("template_parameters") or {},
                guest={"phone": guest_phone},
                event={"id": event_id if event_id and not event_id.startswith("wamid.") else None}
            )

            if outpost_message is None:
                logger.warning(
                    f"Skipping quick_reply processing for {guest_phone} - no event found",
                    extra={"guest": guest_phone, "message_id": message_id}
                )
                return None
            
            logger.info(
                f"Flow transition (quick_reply): {prev_state} -> {next_state}",
                extra={"guest": guest_phone}
            )
            return outpost_message
            
        except Exception as e:
            logger.error(f"Error processing quick reply: {e}")
            raise

    async def send_to_outpost(self, message: Dict[str, Any]):
        """Send processed message to outpost queue (template or free_text)."""
        try:
            # Declare outpost queue
            queue = await self.channel.declare_queue(self.outpost_queue, durable=True)
            
            # Publish message
            await self.channel.default_exchange.publish(
                aio_pika.Message(
                    body=json.dumps(message).encode(),
                    delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
                    headers={"message_type": message.get("message_type", "template")}
                ),
                routing_key=self.outpost_queue
            )
            
            if message.get("message_type") == "template":
                logger.info(
                    "Sent template to outpost",
                    extra={"template": message.get("template"), "recipient": message.get("recipient")}
                )
            else:
                logger.info(f"Sent message to outpost queue: {message.get('text', '')[:50]}...")
            
        except Exception as e:
            logger.error(f"Error sending to outpost queue: {e}")
            raise

    async def process_webhook_message(self, message: aio_pika.IncomingMessage):
        """Process incoming webhook message based on topic"""
        async with message.process():
            try:
                # Parse message
                message_data = json.loads(message.body.decode())
                topic = message_data.get("topic")
                
                logger.info(f"Processing webhook message with topic: {topic}")
                
                # Process based on topic
                if topic == "contacts":
                    processed_message = await self.process_contacts(message_data)
                elif topic == "message":
                    processed_message = await self.process_message(message_data)
                    if processed_message is None:
                        logger.info(f"Skipped processing message - no event found")
                        return
                elif topic == "quick_reply":
                    processed_message = await self.process_quick_reply(message_data)
                    if processed_message is None:
                        logger.info(f"Skipped processing quick_reply - no event found")
                        return
                else:
                    logger.warning(f"Unknown topic: {topic}")
                    return
                
                # Send to outpost queue
                await self.send_to_outpost(processed_message)
                
                logger.info(f"Successfully processed {topic} message")
                
            except Exception as e:
                logger.error(f"Error processing webhook message: {e}")
                # Message will be requeued due to async with message.process()

    async def start_consuming(self):
        """Start consuming messages from webhook queue"""
        try:
            # Declare webhook queue
            queue = await self.channel.declare_queue(self.webhook_queue, durable=True)
            
            # Start consuming
            await queue.consume(self.process_webhook_message)
            
            logger.info(f"Started consuming from {self.webhook_queue}")
            
            # Keep the consumer running
            try:
                await asyncio.Future()  # Run forever
            except KeyboardInterrupt:
                logger.info("Received interrupt signal")
                
        except Exception as e:
            logger.error(f"Error in consuming: {e}")
            raise

    async def run(self):
        """Main run method"""
        try:
            await self.connect()
            await self.start_consuming()
        except KeyboardInterrupt:
            logger.info("Shutting down webhook worker...")
        finally:
            if self.connection:
                await self.connection.close()

async def main():
    """Main entry point"""
    worker = WebhookWorker()
    await worker.run()

if __name__ == "__main__":
    asyncio.run(main())
