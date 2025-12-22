"""
OTP Worker - Consumes OTP messages from RabbitMQ and sends them via Telegram/WhatsApp
"""

import json
import logging
import os
import signal
import sys
from typing import Dict, Any

import pika

from mq import get_rabbit_params, connect_to_rabbitmq
from telegram_sender import send_otp_via_telegram

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
            
            # Send OTP via Telegram (currently)
            # In the future, this can be extended to support WhatsApp based on platform
            send_otp_via_telegram(phone, code)
            
            # Acknowledge message
            ch.basic_ack(delivery_tag=method.delivery_tag)
            logger.info(f"Successfully processed OTP for phone: {phone}")
            
        except ValueError as e:
            # Invalid message format - acknowledge to remove from queue
            logger.error(f"Invalid message format: {e}")
            ch.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as e:
            # Error processing - reject and requeue
            logger.error(f"Error processing message: {e}", exc_info=True)
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

