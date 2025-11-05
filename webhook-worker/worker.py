import asyncio
import json
import logging
import os
import signal
from typing import Any, Dict, Optional

import aio_pika

from flow_manager import FlowManager
from db.init_db import init_db


logger = logging.getLogger("webhook_worker")


class Worker:
    """Consumes WhatsApp webhook events from RabbitMQ and delegates to FlowManager."""

    def __init__(self):
        # RabbitMQ env
        self.rabbit_host = os.getenv("RABBITMQ_HOST", "rabbitmq")
        self.rabbit_port = int(os.getenv("RABBITMQ_PORT", "5672"))
        self.rabbit_user = os.getenv("RABBITMQ_USER", "guest")
        self.rabbit_password = os.getenv("RABBITMQ_PASSWORD", "guest")
        self.webhook_queue = os.getenv("WEBHOOK_QUEUE", "webhook_queue")
        self.outpost_queue = os.getenv("OUTPOST_QUEUE_NAME", os.getenv("OUTPOST_QUEUE", "outpost_queue"))

        self.connection: Optional[aio_pika.RobustConnection] = None
        self.channel: Optional[aio_pika.abc.AbstractChannel] = None
        self.out_channel: Optional[aio_pika.abc.AbstractChannel] = None

        self.flow_manager = FlowManager(outpost_queue=self.outpost_queue)

    async def connect(self) -> None:
        url = f"amqp://{self.rabbit_user}:{self.rabbit_password}@{self.rabbit_host}:{self.rabbit_port}/"
        logger.info(f"Connecting to RabbitMQ {self.rabbit_host}:{self.rabbit_port}")
        self.connection = await aio_pika.connect_robust(url, heartbeat=60, blocked_connection_timeout=300)
        self.channel = await self.connection.channel()
        await self.channel.set_qos(prefetch_count=8)

        # Separate publish channel
        self.out_channel = await self.connection.channel()
        await self.out_channel.set_qos(prefetch_count=8)

        # Declare queues
        await self.channel.declare_queue(self.webhook_queue, durable=True)
        await self.out_channel.declare_queue(self.outpost_queue, durable=True)

        # Provide publisher to flow manager
        self.flow_manager.attach_publisher(self.out_channel, self.outpost_queue)

        logger.info(
            "Connected and declared queues",
            extra={"webhook_queue": self.webhook_queue, "outpost_queue": self.outpost_queue},
        )

    async def _handle(self, body: bytes) -> None:
        try:
            msg = json.loads(body.decode("utf-8"))
        except Exception as e:
            logger.error(f"Invalid JSON in webhook message: {e}")
            return

        # Normalize incoming
        payload: Dict[str, Any] = msg.get("payload", {})
        event_id = msg.get("event_id") or payload.get("event_id")
        guest_phone = msg.get("guest_phone") or msg.get("recipient") or msg.get("from")
        message_type = msg.get("message_type") or msg.get("type") or msg.get("topic") or "message"

        # Extract text/button for message types
        extracted = payload.get("extracted_data", {}) if isinstance(payload, dict) else {}
        button_text = extracted.get("button_title") or extracted.get("button_text") or extracted.get("button_id")
        text = extracted.get("text") or button_text or ""

        # WhatsApp reply context id
        context_id = None
        if isinstance(payload, dict):
            ctx = payload.get("context") or {}
            context_id = ctx.get("id") or msg.get("reply_to_message_id")

        logger.info(
            "Consumed webhook event",
            extra={"guest": guest_phone, "event_id": event_id, "type": message_type, "context_id": context_id},
        )

        await self.flow_manager.handle_event(
            message_type=message_type,
            guest_phone=str(guest_phone) if guest_phone else None,
            event_id=str(event_id) if event_id else None,
            text=text,
            raw=msg,
            context_id=context_id,
        )

    async def _on_message(self, message: aio_pika.IncomingMessage) -> None:
        async with message.process():
            await self._handle(message.body)

    async def start(self) -> None:
        await self.connect()
        queue = await self.channel.declare_queue(self.webhook_queue, durable=True)
        await queue.consume(self._on_message)
        logger.info("Webhook worker started", extra={"queue": self.webhook_queue})

    async def close(self) -> None:
        try:
            if self.channel and not self.channel.is_closed:
                await self.channel.close()
            if self.out_channel and not self.out_channel.is_closed:
                await self.out_channel.close()
            if self.connection and not self.connection.is_closed:
                await self.connection.close()
        finally:
            logger.info("Webhook worker shutdown complete")


async def main():
    logging.basicConfig(level=logging.INFO)
    
    # Initialize database tables
    try:
        await init_db()
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        # Continue anyway - tables might already exist
    
    worker = Worker()
    stop = asyncio.Event()

    loop = asyncio.get_running_loop()

    def _sig():
        stop.set()

    for s in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(s, _sig)

    # simple retry loop for startup
    while not stop.is_set():
        try:
            await worker.start()
            break
        except Exception as e:
            logger.error(f"Failed to start worker: {e}")
            await asyncio.sleep(5)

    try:
        while not stop.is_set():
            await asyncio.sleep(1)
    finally:
        await worker.close()


if __name__ == "__main__":
    asyncio.run(main())
