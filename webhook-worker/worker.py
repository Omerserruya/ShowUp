import asyncio
import json
import logging
import os
import signal
import uuid
from typing import Any, Dict, Optional

import aio_pika
from aio_pika.abc import AbstractIncomingMessage
from redis import asyncio as aioredis

from flow_manager import ConversationFlowManager


logger = logging.getLogger(__name__)


class WebhookWorker:
    """Consumes webhook messages and produces outpost messages."""

    def __init__(self):
        # Env
        self.rabbit_host = os.getenv("RABBITMQ_HOST")
        self.rabbit_port = int(os.getenv("RABBITMQ_PORT"))
        self.rabbit_user = os.getenv("RABBITMQ_USER")
        self.rabbit_password = os.getenv("RABBITMQ_PASSWORD")
        self.webhook_queue = os.getenv("WEBHOOK_QUEUE")
        self.outpost_queue = os.getenv("OUTPOST_QUEUE")
        self.redis_url = os.getenv("REDIS_URL")

        # Connections
        self.connection: Optional[aio_pika.RobustConnection] = None
        self.channel: Optional[aio_pika.abc.AbstractChannel] = None
        self.out_channel: Optional[aio_pika.abc.AbstractChannel] = None
        self.consumer_tag: Optional[str] = None

        # Flow manager
        self.flow = ConversationFlowManager(redis_url=self.redis_url)

    async def connect(self):
        connection_url = f"amqp://{self.rabbit_user}:{self.rabbit_password}@{self.rabbit_host}:{self.rabbit_port}/"
        self.connection = await aio_pika.connect_robust(connection_url, heartbeat=60, blocked_connection_timeout=300)
        self.channel = await self.connection.channel()
        await self.channel.set_qos(prefetch_count=4)

        # Dedicated channel for publishing to outpost
        self.out_channel = await self.connection.channel()

        # Declare queues
        await self.channel.declare_queue(self.webhook_queue, durable=True)
        await self.out_channel.declare_queue(self.outpost_queue, durable=True)
        logger.info("Connected to RabbitMQ and declared queues", extra={"webhook_queue": self.webhook_queue, "outpost_queue": self.outpost_queue})

    async def _publish_outpost(self, message: Dict[str, Any]) -> None:
        body = json.dumps(message, ensure_ascii=False).encode("utf-8")
        await self.out_channel.default_exchange.publish(
            aio_pika.Message(body=body, delivery_mode=aio_pika.DeliveryMode.PERSISTENT),
            routing_key=self.outpost_queue,
        )
        logger.info("Published next message to outpost_queue")

        # Generate temp id and store message context so reply context can find the correct state even before WA id exists
        try:
            temp_id = f"temp-{uuid.uuid4()}"
            await self.flow.store_message_context(
                message_id=temp_id,
                state=str(message.get("state")),
                event_id=str(message.get("event_id")),
                guest_phone=str(message.get("recipient")),
            )
            logger.debug("Stored temp message_context", extra={"temp_id": temp_id, "state": message.get("state")})
        except Exception as e:
            logger.warning(f"Failed storing temp message context: {e}")

    @staticmethod
    def _extract_incoming(msg: Dict[str, Any]) -> Dict[str, Any]:
        # Normalize incoming payload
        payload = msg.get("payload", {})
        message_type = msg.get("message_type") or msg.get("type") or "message"
        guest_phone = msg.get("guest_phone") or msg.get("recipient") or msg.get("phone")
        event_id = msg.get("event_id") or payload.get("event_id")

        # For quick_reply, extract button text/title if present
        extracted = payload.get("extracted_data", {})
        button_title = extracted.get("button_title") or extracted.get("button_text") or ""
        text = extracted.get("text") or button_title or ""

        # WhatsApp reply context id
        context_id = None
        if isinstance(payload, dict):
            ctx = payload.get("context") or {}
            context_id = ctx.get("id") or msg.get("reply_to_message_id")

        return {
            "message_type": "quick_reply" if message_type == "quick_reply" else ("free_text" if message_type in ("message", "free_text", "text") else message_type),
            "guest_phone": guest_phone,
            "event_id": event_id,
            "text": text,
            "context_id": context_id,
            "template_parameters": payload.get("template_parameters") or {},
        }

    async def _handle_message(self, message_body: bytes) -> None:
        try:
            msg = json.loads(message_body.decode("utf-8"))
        except Exception:
            logger.error("Invalid JSON message from webhook_queue")
            return

        normalized = self._extract_incoming(msg)
        guest_phone = normalized.get("guest_phone")
        event_id = normalized.get("event_id")
        if not guest_phone or not event_id:
            logger.error("Missing guest_phone or event_id in incoming message")
            return

        logger.info("Consumed message from webhook_queue", extra={"guest": guest_phone, "type": normalized.get("message_type")})

        outgoing, prev_state, next_state = await self.flow.process_incoming(
            message_type=normalized.get("message_type"),
            guest_phone=guest_phone,
            text=normalized.get("text") or "",
            event_id=event_id,
            context_id=normalized.get("context_id"),
            template_parameters=normalized.get("template_parameters")
        )

        logger.info("Current state resolved", extra={"prev": prev_state, "next": next_state})
        await self._publish_outpost(outgoing)

    async def _on_message(self, message: AbstractIncomingMessage) -> None:
        async with message.process():
            await self._handle_message(message.body)

    async def start(self) -> None:
        await self.connect()
        queue = await self.channel.declare_queue(self.webhook_queue, durable=True)
        await queue.consume(self._on_message)
        logger.info("Webhook-worker started consuming", extra={"queue": self.webhook_queue})

    async def close(self) -> None:
        try:
            if self.channel and not self.channel.is_closed:
                await self.channel.close()
            if self.out_channel and not self.out_channel.is_closed:
                await self.out_channel.close()
            if self.connection and not self.connection.is_closed:
                await self.connection.close()
        finally:
            logger.info("Webhook-worker shutdown complete")


async def _run():
    logging.basicConfig(level=logging.INFO)
    worker = WebhookWorker()
    stop = asyncio.Event()

    def _signal_handler():
        stop.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _signal_handler)

    # retry connect loop
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
    asyncio.run(_run())
