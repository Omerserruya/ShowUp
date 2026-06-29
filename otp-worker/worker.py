"""
OTP Worker - Consumes OTP messages from RabbitMQ and delivers them over WhatsApp
using the approved Hebrew authentication template "otp".
"""

import json
import logging
import os
import signal
import sys
import time
from typing import Dict, Any

import pika

from mq import get_rabbit_params, connect_to_rabbitmq
from whatsapp_sender import send_otp_via_whatsapp

# Seconds to wait before requeueing a transiently-failed OTP, so a sustained
# WhatsApp outage retries slowly instead of in a tight CPU/API-burning loop.
RETRY_BACKOFF_SECONDS = float(os.getenv("OTP_RETRY_BACKOFF_SECONDS", "5"))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class OTPWorker:
    """Worker that consumes OTP messages from RabbitMQ and sends them."""
    
    def __init__(self):
        self.connection = None
        self.channel = None
        self.queue_name = os.getenv("OTP_QUEUE_NAME", "otp_queue")
        self.running = False
        
    def connect(self):
        """Connect to RabbitMQ."""
        try:
            params = get_rabbit_params()
            self.connection, self.channel = connect_to_rabbitmq(params, self.queue_name)
            logger.info(f"Connected to RabbitMQ, listening on queue: {self.queue_name}")
        except Exception as e:
            logger.error(f"Failed to connect to RabbitMQ: {e}")
            raise
    
    def parse_message(self, body: bytes) -> Dict[str, Any]:
        """
        Parse message from RabbitMQ queue.
        
        Expected format:
        {
            "recipient": "+972501234567",  # or "phone" for backward compatibility
            "code": "123456",
            "platform": "WA"  # optional, for future use
        }
        
        Returns:
            Dict with 'phone' and 'code' keys
        """
        try:
            message = json.loads(body.decode('utf-8'))
            
            # Validate required fields
            if 'code' not in message:
                raise ValueError("Missing 'code' field in message")
            
            # Support both 'recipient' and 'phone' fields (backward compatibility)
            phone = message.get('recipient') or message.get('phone')
            if not phone:
                raise ValueError("Missing 'recipient' or 'phone' field in message")
            
            return {
                'phone': phone,
                'code': message['code'],
                'platform': message.get('platform', 'WA')  # Default to WA for backward compatibility
            }
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse JSON message: {e}")
            raise ValueError(f"Invalid JSON format: {e}")
        except Exception as e:
            logger.error(f"Failed to parse message: {e}")
            raise
    
    def process_message(self, ch, method, properties, body):
        """
        Process a single OTP message.
        
        Args:
            ch: Channel
            method: Method
            properties: Properties
            body: Message body (bytes)
        """
        try:
            logger.info(f"Received message: {body.decode('utf-8')}")
            
            # Parse message
            message_data = self.parse_message(body)
            phone = message_data['phone']
            code = message_data['code']
            platform = message_data.get('platform', 'WA')
            
            logger.info(f"Processing OTP: phone={phone}, code={code}, platform={platform}")

            # Deliver the OTP over WhatsApp using the approved "otp" template.
            outcome = send_otp_via_whatsapp(phone, code)

            if outcome == "sent":
                ch.basic_ack(delivery_tag=method.delivery_tag)
                logger.info(f"Successfully sent OTP via WhatsApp for phone: {phone}")
            elif outcome == "permanent":
                # Will never succeed as-is (e.g. expired token, bad params).
                # Requeuing would hot-loop and flood the API/logs, so drop it.
                logger.error(
                    f"Permanent WhatsApp OTP failure for {phone}; dropping message "
                    f"(check WA_API_B token / template config)"
                )
                ch.basic_ack(delivery_tag=method.delivery_tag)
            else:
                # Transient failure — back off before requeueing so a sustained
                # outage retries slowly instead of in a tight loop.
                logger.warning(f"Transient WhatsApp OTP failure for {phone}; requeueing after backoff")
                time.sleep(RETRY_BACKOFF_SECONDS)
                ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

        except ValueError as e:
            # Invalid message format - acknowledge to remove from queue
            logger.error(f"Invalid message format: {e}")
            ch.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as e:
            # Unexpected error - back off then requeue to avoid a hot loop.
            logger.error(f"Error processing message: {e}", exc_info=True)
            time.sleep(RETRY_BACKOFF_SECONDS)
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
    
    def start_consuming(self):
        """Start consuming messages from the queue."""
        try:
            # Set QoS to process one message at a time
            self.channel.basic_qos(prefetch_count=1)
            
            # Start consuming
            self.channel.basic_consume(
                queue=self.queue_name,
                on_message_callback=self.process_message
            )
            
            self.running = True
            logger.info(f"Starting to consume messages from queue: {self.queue_name}")
            self.channel.start_consuming()
            
        except KeyboardInterrupt:
            logger.info("Received interrupt signal, stopping...")
            self.stop()
        except Exception as e:
            logger.error(f"Error consuming messages: {e}", exc_info=True)
            raise
    
    def stop(self):
        """Stop consuming messages and close connections."""
        self.running = False
        if self.channel:
            self.channel.stop_consuming()
        if self.connection and not self.connection.is_closed:
            self.connection.close()
        logger.info("Worker stopped")


def main():
    """Main entry point."""
    worker = OTPWorker()
    
    # Setup signal handlers for graceful shutdown
    def signal_handler(sig, frame):
        logger.info("Received signal, shutting down gracefully...")
        worker.stop()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        worker.connect()
        worker.start_consuming()
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()

