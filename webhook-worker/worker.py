import asyncio
import json
import logging
import os
import signal
from typing import Any, Dict, Optional

import aio_pika

from flow_manager import FlowManager
from db.init_db import init_db
from utils.phone import mask_phone, normalize_phone


logger = logging.getLogger("webhook_worker")

# Bounded retries. A failed message is re-published to a RETRY queue whose TTL
# dead-letters it back onto the main queue, so a transient DB/broker problem is
# retried after a delay instead of hot-looping or being silently acked away.
# After MAX_ATTEMPTS it lands in the DLQ for inspection / manual replay.
#
# NOTE: queue arguments are immutable once a queue exists. The main webhook
# queue keeps its original (argument-less) declaration; the retry delay is a
# property of the NEW retry queue - changing WEBHOOK_RETRY_DELAY_MS later
# requires deleting `<queue>_retry` first (it holds only in-flight retries).
RETRY_HEADER = "x-retry-count"
MAX_ATTEMPTS = int(os.getenv("WEBHOOK_MAX_RETRIES", "5"))
RETRY_DELAY_MS = int(os.getenv("WEBHOOK_RETRY_DELAY_MS", "30000"))
PREFETCH = int(os.getenv("WEBHOOK_PREFETCH", "8"))
SEEN_CLEANUP_INTERVAL_S = 3600


class Worker:
    """Consumes WhatsApp webhook events from RabbitMQ and delegates to FlowManager."""

    def __init__(self):
        # RabbitMQ env
        self.rabbit_host = os.getenv("RABBITMQ_HOST", "rabbitmq")
        self.rabbit_port = int(os.getenv("RABBITMQ_PORT", "5672"))
        self.rabbit_user = os.getenv("RABBITMQ_USER", "guest")
        self.rabbit_password = os.getenv("RABBITMQ_PASSWORD", "guest")
        self.webhook_queue = os.getenv("WEBHOOK_QUEUE") or "webhook_queue"
        self.retry_queue = os.getenv("WEBHOOK_RETRY_QUEUE") or f"{self.webhook_queue}_retry"
        self.dlq = os.getenv("WEBHOOK_DLQ") or f"{self.webhook_queue}_dlq"
        self.outpost_queue = os.getenv("OUTPOST_QUEUE_NAME", os.getenv("OUTPOST_QUEUE", "outpost_queue"))
        # Conversational replies to guests go to outpost's PRIORITY queue so a
        # guest's "how many are you?" never waits behind a 5,000-message round.
        self.outpost_priority_queue = os.getenv("OUTPOST_PRIORITY_QUEUE") or "outpost_priority_queue"

        self.connection: Optional[aio_pika.RobustConnection] = None
        self.channel: Optional[aio_pika.abc.AbstractChannel] = None
        self.out_channel: Optional[aio_pika.abc.AbstractChannel] = None
        self._cleanup_task: Optional[asyncio.Task] = None

        self.flow_manager = FlowManager(outpost_queue=self.outpost_priority_queue)

    async def connect(self) -> None:
        url = f"amqp://{self.rabbit_user}:{self.rabbit_password}@{self.rabbit_host}:{self.rabbit_port}/"
        logger.info(f"Connecting to RabbitMQ {self.rabbit_host}:{self.rabbit_port}")
        self.connection = await aio_pika.connect_robust(url, heartbeat=60, blocked_connection_timeout=300)
        self.channel = await self.connection.channel()
        await self.channel.set_qos(prefetch_count=PREFETCH)

        # Separate publish channel, with publisher confirms (aio-pika default):
        # `publish` returns only once the broker has the message.
        self.out_channel = await self.connection.channel(publisher_confirms=True)

        # Declare queues. Plain durable queues - the declaration must match the
        # one in outpost-service exactly, or the second declarer gets
        # PRECONDITION_FAILED. Declaring here means deploy order doesn't matter.
        await self.channel.declare_queue(self.webhook_queue, durable=True)
        await self.out_channel.declare_queue(self.outpost_queue, durable=True)
        await self.out_channel.declare_queue(self.outpost_priority_queue, durable=True)
        await self.out_channel.declare_queue(
            self.retry_queue,
            durable=True,
            arguments={
                "x-message-ttl": RETRY_DELAY_MS,
                "x-dead-letter-exchange": "",
                "x-dead-letter-routing-key": self.webhook_queue,
            },
        )
        await self.out_channel.declare_queue(self.dlq, durable=True)

        # Provide publisher to flow manager
        self.flow_manager.attach_publisher(self.out_channel, self.outpost_priority_queue)

        logger.info(
            "Connected and declared queues",
            extra={
                "webhook_queue": self.webhook_queue,
                "retry_queue": self.retry_queue,
                "dlq": self.dlq,
                "reply_queue": self.outpost_priority_queue,
            },
        )

    def _extract_incoming(self, msg: Dict[str, Any]) -> Dict[str, Any]:
        payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
        raw_event_id = msg.get("event_id") or (payload.get("event_id") if payload else None)
        event_id = raw_event_id
        if isinstance(event_id, str) and event_id.startswith("wamid."):
            event_id = None
        raw_guest_phone = (
            msg.get("guest_phone")
            or msg.get("recipient")
            or msg.get("from")
            or (payload.get("recipient") if payload else None)
        )
        # Normalize phone number to canonical format (digits only, no +, no 00 prefix)
        guest_phone = normalize_phone(raw_guest_phone)
        message_type = msg.get("message_type") or msg.get("type") or msg.get("topic") or "message"

        normalized_type = (
            "quick_reply"
            if message_type == "quick_reply"
            else "free_text"
            if message_type in ("message", "free_text", "text")
            else "status.update"
            if message_type == "status.update"
            else message_type
        )

        extracted = payload.get("extracted_data", {}) if payload else {}
        # Semantic signal (independent of the displayed label): the Meta button
        # payload, else the quick-reply button id. Resolved to an RsvpAction in the
        # flow manager. The button title is presentation only and is kept just as a
        # legacy text fallback.
        button_id = extracted.get("button_id")
        button_payload = extracted.get("button_payload")
        button_text = extracted.get("button_title") or extracted.get("button_text") or extracted.get("button_id")
        text_value = extracted.get("text") or button_text or msg.get("text") or (payload.get("text") if payload else None) or ""

        # Which kind of reply this is. "template_button" = a quick-reply on a
        # Meta TEMPLATE (invitation / reminder) - the only messages whose buttons
        # carry RSVP semantics regardless of where the conversation stands.
        reply_kind = extracted.get("reply_kind")
        if not reply_kind and payload.get("type") == "button":
            reply_kind = "template_button"

        logger.debug(
            "Extracted message data",
            extra={"message_type": message_type, "normalized_type": normalized_type, "reply_kind": reply_kind},
        )

        context_id = None
        if payload:
            ctx = payload.get("context") or {}
            context_id = ctx.get("id") or msg.get("reply_to_message_id")

        template_params = payload.get("template_parameters") if payload else {}

        status_payload = payload if normalized_type == "status.update" and payload else {}
        wa_message_id = msg.get("wa_message_id") or msg.get("message_id") or (payload.get("id") if payload else None)

        # Meta's own timestamp (unix seconds) - when the guest actually wrote.
        sent_ts: Optional[int] = None
        try:
            if payload and payload.get("timestamp"):
                sent_ts = int(str(payload.get("timestamp")))
        except (TypeError, ValueError):
            sent_ts = None

        return {
            "message_type": normalized_type,
            "guest_phone": guest_phone,  # Already normalized
            "event_id": str(event_id) if event_id else None,
            "text": text_value,
            "button_id": button_id,
            "button_payload": button_payload,
            "reply_kind": reply_kind,
            "context_id": context_id,
            "template_parameters": template_params or {},
            "status_payload": status_payload or {},
            "wa_message_id": wa_message_id,
            "sent_ts": sent_ts,
        }

    async def _handle(self, msg: Dict[str, Any]) -> None:
        """Process one decoded webhook item. Raises on failure (-> retry)."""
        try:
            from shared.obs import clear_context, adopt_from, set_flow
            clear_context()
            adopt_from(msg)
            set_flow(worker="webhook-worker", flow="rsvp")
        except Exception:
            pass
        await self._dispatch(msg)

    async def _dispatch(self, msg: dict) -> None:
        normalized = self._extract_incoming(msg)
        msg_type = normalized.get("message_type")
        guest_phone = normalized.get("guest_phone")
        event_id = normalized.get("event_id")
        try:
            from shared.obs import set_event, log_event
            set_event(event_id=event_id)
            log_event("webhook.processed", message_type=msg_type)
        except Exception:
            pass

        logger.info(
            "Dispatching message type=%s guest=%s wamid=%s context=%s",
            msg_type, mask_phone(guest_phone), normalized.get("wa_message_id"), normalized.get("context_id"),
        )

        if msg_type == "status.update":
            await self.flow_manager.handle_status_update(
                wa_message_id=normalized.get("wa_message_id"),
                status_payload=normalized.get("status_payload") or {},
                guest_phone=guest_phone,
                event_id=event_id,
            )
            return

        await self.flow_manager.handle_inbound(
            wamid=normalized.get("wa_message_id"),
            message_type=msg_type,
            guest_phone=guest_phone,
            text=normalized.get("text") or "",
            button_id=normalized.get("button_id"),
            button_payload=normalized.get("button_payload"),
            reply_kind=normalized.get("reply_kind"),
            event_id=event_id,
            context_id=normalized.get("context_id"),
            raw=msg,
            template_parameters=normalized.get("template_parameters"),
            sent_ts=normalized.get("sent_ts"),
        )

    async def _republish(self, message: aio_pika.IncomingMessage, routing_key: str, attempts: int) -> None:
        headers = dict(message.headers or {})
        headers[RETRY_HEADER] = attempts
        await self.out_channel.default_exchange.publish(
            aio_pika.Message(
                body=message.body,
                headers=headers,
                content_type=message.content_type or "application/json",
                delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            ),
            routing_key=routing_key,
        )

    async def _on_message(self, message: aio_pika.IncomingMessage) -> None:
        try:
            msg = json.loads(message.body.decode("utf-8"))
            if not isinstance(msg, dict):
                raise ValueError("webhook message is not a JSON object")
        except Exception as e:
            logger.error("Invalid webhook message, moving to DLQ: %s", e)
            await self._to_dlq_or_requeue(message, attempts=0)
            return

        try:
            await self._handle(msg)
        except Exception as e:
            attempts = 0
            try:
                attempts = int((message.headers or {}).get(RETRY_HEADER) or 0)
            except (TypeError, ValueError):
                attempts = 0
            attempts += 1
            logger.exception("webhook processing failed (attempt %d/%d)", attempts, MAX_ATTEMPTS)
            try:
                from shared.obs import capture
                capture(e, operation="handle_webhook", flow="rsvp", worker="webhook-worker", attempt=attempts)
            except Exception:
                pass
            if attempts < MAX_ATTEMPTS:
                try:
                    await self._republish(message, self.retry_queue, attempts)
                    await message.ack()
                except Exception as pub_exc:
                    logger.error("Could not schedule retry, requeueing: %s", pub_exc)
                    await asyncio.sleep(2)
                    await message.nack(requeue=True)
            else:
                await self._to_dlq_or_requeue(message, attempts=attempts)
            return

        await message.ack()

    async def _to_dlq_or_requeue(self, message: aio_pika.IncomingMessage, attempts: int) -> None:
        try:
            await self._republish(message, self.dlq, attempts)
            await message.ack()
            logger.error("Webhook message dead-lettered to %s after %d attempt(s)", self.dlq, attempts)
        except Exception as pub_exc:
            logger.error("Could not dead-letter message, requeueing: %s", pub_exc)
            await asyncio.sleep(2)
            await message.nack(requeue=True)

    async def _cleanup_loop(self) -> None:
        while True:
            try:
                await self.flow_manager.cleanup_seen()
            except Exception as e:
                logger.warning("inbound_seen cleanup failed: %s", e)
            await asyncio.sleep(SEEN_CLEANUP_INTERVAL_S)

    async def start(self) -> None:
        await self.connect()
        queue = await self.channel.declare_queue(self.webhook_queue, durable=True)
        await queue.consume(self._on_message, no_ack=False)
        if self._cleanup_task is None:
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        logger.info("Webhook worker started", extra={"queue": self.webhook_queue})

    async def close(self) -> None:
        try:
            if self._cleanup_task:
                self._cleanup_task.cancel()
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

    try:
        from shared.obs import bootstrap
        bootstrap("webhook-worker")
    except Exception:
        pass

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
