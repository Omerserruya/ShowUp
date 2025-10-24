#!/usr/bin/env python3
"""
Outpost Service - WhatsApp Message Sender

This service connects to RabbitMQ, listens for messages on the outpost_queue,
and sends them via WhatsApp Business Cloud API.
"""

import asyncio
import logging
import os
import signal
import sys
from typing import Dict, Any

from rabbit_consumer import RabbitMQConsumer
from utils.logger import setup_logger


class OutpostService:
    """Main service class for handling WhatsApp message sending."""
    
    def __init__(self):
        self.logger = setup_logger("outpost")
        self.consumer = None
        self.running = False
        
    async def start(self):
        """Start the outpost service."""
        self.logger.info("🚀 Starting Outpost Service...")
        
        # Validate required environment variables
        required_vars = ["WA_API_B", "WA_PHONE_ID", "RABBITMQ_HOST", "RABBITMQ_PORT", "RABBITMQ_USER", "RABBITMQ_PASSWORD"]
        missing_vars = [var for var in required_vars if not os.getenv(var)]
        
        if missing_vars:
            self.logger.error(f"Missing required environment variables: {missing_vars}")
            sys.exit(1)
        
        # Validate WhatsApp credentials format
        wa_api_b = os.getenv("WA_API_B")
        wa_phone_id = os.getenv("WA_PHONE_ID")
        
        if not wa_api_b or len(wa_api_b) < 10:
            self.logger.error("WA_API_B appears to be invalid (too short or empty)")
            sys.exit(1)
            
        if not wa_phone_id or not wa_phone_id.isdigit():
            self.logger.error("WA_PHONE_ID must be a numeric phone number ID")
            sys.exit(1)
            
        self.logger.info(f"Using WhatsApp Phone ID: {wa_phone_id}")
        self.logger.info(f"Using WhatsApp API Token: {wa_api_b[:10]}...")
        
        # Test WhatsApp API connection
        from whatsapp_sender import WhatsAppSender
        test_sender = WhatsAppSender()
        test_result = await test_sender.test_connection()
        
        if test_result.get("success"):
            self.logger.info("✅ WhatsApp API connection test successful")
        else:
            self.logger.error("❌ WhatsApp API connection test failed")
            self.logger.error(f"Test result: {test_result}")
        
        # Initialize RabbitMQ consumer
        self.consumer = RabbitMQConsumer()
        
        # Set up signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
        
        self.running = True
        self.logger.info("📡 Outpost Service started — listening on queue: outpost_queue")
        
        try:
            await self.consumer.start_consuming()
        except Exception as e:
            self.logger.error(f"Service error: {e}")
            raise
        finally:
            await self.shutdown()
    
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals."""
        self.logger.info(f"Received signal {signum}, initiating graceful shutdown...")
        self.running = False
        if self.consumer:
            asyncio.create_task(self.consumer.stop())
    
    async def shutdown(self):
        """Gracefully shutdown the service."""
        self.logger.info("🛑 Shutting down Outpost Service...")
        if self.consumer:
            await self.consumer.close()
        self.logger.info("✅ Outpost Service stopped")


async def main():
    """Main entry point."""
    service = OutpostService()
    await service.start()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Goodbye!")
    except Exception as e:
        print(f"❌ Fatal error: {e}")
        sys.exit(1)
