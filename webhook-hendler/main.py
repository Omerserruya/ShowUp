"""WhatsApp webhook handler: verify, categorise and durably enqueue Meta webhooks.

Delivery contract with Meta: we answer 200 ONLY when every message/status in the
request is confirmed by RabbitMQ (publisher confirms). Any enqueue failure ->
503, so Meta retries the whole request. Retries can therefore re-deliver items
that did make it the first time; webhook-worker de-duplicates by wamid
(`inbound_seen`), so at-least-once here is safe.

Publishing runs on ONE long-lived connection per process, owned by a dedicated
publisher thread (pika's BlockingConnection is not thread-safe, and opening a
connection per message inside the event loop is what caused timeouts under
load). Request handlers hand work to the thread and await a Future, so nothing
blocks the event loop. Running several uvicorn workers is supported: each worker
process starts its own publisher thread/connection.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import hashlib
import hmac
import json
import logging
import os
import queue as _queue
import threading
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import pika
import uvicorn
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from jsonschema import ValidationError, validate

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="WhatsApp Webhook Handler",
    description="WhatsApp webhook handler that validates, categorizes, and enqueues messages",
    version="1.1.0",
)

try:
    from shared.obs.fastapi import install_fastapi_observability
    install_fastapi_observability(app)
except Exception:
    pass

# Environment variables
VERIFY_TOKEN = (os.getenv("WEBHOOK_VERIFY_TOKEN") or "").strip()
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET")
RABBITMQ_HOST = os.getenv("RABBITMQ_HOST", "rabbitmq")
RABBITMQ_PORT = int(os.getenv("RABBITMQ_PORT") or 5672)
RABBITMQ_USER = os.getenv("RABBITMQ_USER", "guest")
RABBITMQ_PASSWORD = os.getenv("RABBITMQ_PASSWORD", "guest")
WEBHOOK_QUEUE = os.getenv("WEBHOOK_QUEUE") or "webhook_queue"
CONTACT_IMPORT_QUEUE = os.getenv("CONTACT_IMPORT_QUEUE", "contact_import_queue")
# How long a request waits for the broker to confirm a publish before we give
# up and return 5xx (Meta's own webhook timeout is ~10s).
PUBLISH_TIMEOUT_S = float(os.getenv("WEBHOOK_PUBLISH_TIMEOUT_S", "5"))

# Per-handler inbound routing. The shared webhook serves every business number
# (OTP / AI assistant / campaigns & RSVP); inbound guest messages are routed by
# WHICH number received them. With the per-handler ids unset (single-number
# deploys) everything falls through to WEBHOOK_QUEUE exactly as before.
ASSISTANT_WA_PHONE_ID = (os.getenv("ASSISTANT_WA_PHONE_ID") or "").strip()
OTP_WA_PHONE_ID = (os.getenv("OTP_WA_PHONE_ID") or "").strip()
ASSISTANT_INBOUND_QUEUE = os.getenv("ASSISTANT_INBOUND_QUEUE", "assistant_inbound_queue")

PORT = int(os.getenv("PORT") or 8000)

# Message types we route to a consumer. Everything else Meta may send
# (reaction, sticker, location, unsupported, system, order, request_welcome,
# ephemeral, ...) is acknowledged with 200 and ignored - answering 400 made Meta
# retry a 👍 reaction for days.
ROUTED_TYPES = {"text", "button", "interactive", "contacts", "image", "video", "audio", "document"}
MEDIA_TYPES = {"image", "video", "audio", "document"}


def route_inbound_message(wa_phone_number_id: Optional[str]) -> Optional[str]:
    """Pick the queue for an inbound *message* by receiving business number.

    Returns a queue name, or the sentinel "drop" for numbers that must never
    feed a conversational flow (the OTP sender is no-reply). None = default
    WEBHOOK_QUEUE (campaigns & RSVP flow). Status updates are NOT routed here -
    delivery receipts are processed uniformly off WEBHOOK_QUEUE.
    """
    pid = str(wa_phone_number_id or "").strip()
    if not pid:
        return None
    if ASSISTANT_WA_PHONE_ID and pid == ASSISTANT_WA_PHONE_ID:
        return ASSISTANT_INBOUND_QUEUE
    if OTP_WA_PHONE_ID and pid == OTP_WA_PHONE_ID:
        return "drop"
    return None


# Envelope-only schema. Individual messages are inspected leniently: an unknown
# or malformed item is skipped (and acked), never a reason to reject the whole
# request - a 4xx makes Meta re-send the same payload over and over.
WHATSAPP_MESSAGE_SCHEMA = {
    "type": "object",
    "properties": {
        "object": {"type": "string"},
        "entry": {"type": "array", "items": {"type": "object"}},
    },
    "required": ["object", "entry"],
}


def mask_phone(phone: Any) -> str:
    s = "".join(ch for ch in str(phone or "") if ch.isdigit())
    return f"***{s[-4:]}" if s else "-"


def verify_webhook_signature(payload: bytes, signature: str, secret: Optional[str]) -> bool:
    """Verify the HMAC signature from Meta"""
    if not secret or not signature:
        return False
    try:
        if signature.startswith("sha256="):
            signature = signature[7:]
        expected_signature = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
        return hmac.compare_digest(signature, expected_signature)
    except Exception as e:
        logger.error(f"Error verifying signature: {e}")
        return False


def validate_whatsapp_message(data: Dict[str, Any]) -> bool:
    try:
        validate(instance=data, schema=WHATSAPP_MESSAGE_SCHEMA)
        return True
    except ValidationError as e:
        logger.error("Schema validation failed: %s", e.message)
        return False


def categorize_message(message: Dict[str, Any]) -> Optional[str]:
    """Categorise a message, or None when it should be acked and ignored."""
    msg_type = message.get("type", "")
    if msg_type not in ROUTED_TYPES:
        return None
    if msg_type == "interactive":
        itype = (message.get("interactive") or {}).get("type")
        if itype in ("button_reply", "list_reply"):
            return "quick_reply"
        return None  # nfm_reply etc. - nothing consumes them yet
    if msg_type == "button":
        return "quick_reply"
    if msg_type == "contacts":
        return "contacts"
    return "message"


def extract_message_data(message: Dict[str, Any], category: str) -> Dict[str, Any]:
    """Extract relevant data based on message category"""
    if category == "quick_reply":
        interactive = message.get("interactive") or {}
        itype = interactive.get("type")
        if itype in ("button_reply", "list_reply"):
            # A list-row choice is routed exactly like a button: the row id is the
            # semantic signal, the row title is the display text.
            reply = interactive.get(itype) or {}
            return {
                "button_id": reply.get("id"),
                "button_title": reply.get("title"),
                "reply_kind": itype,
            }
        # Template quick-reply (type "button"). The payload is the semantic
        # signal used to resolve the RSVP action downstream.
        button = message.get("button") or {}
        return {
            "button_id": button.get("id"),
            "button_payload": button.get("payload"),
            "button_title": button.get("title"),
            "button_text": button.get("text"),
            "reply_kind": "template_button",
        }
    if category == "contacts":
        contacts = message.get("contacts") or []
        return {
            "contacts": [
                {
                    "name": (contact.get("name") or {}).get("formatted_name"),
                    "phones": [phone.get("phone") for phone in contact.get("phones") or []],
                    "emails": [email.get("email") for email in contact.get("emails") or []],
                }
                for contact in contacts
            ]
        }
    msg_type = message.get("type")
    text = (message.get("text") or {}).get("body")
    if text is None and msg_type in MEDIA_TYPES:
        # A captioned photo is still something the guest wrote.
        text = (message.get(msg_type) or {}).get("caption")
    return {
        "text": text,
        "media_type": msg_type if msg_type in MEDIA_TYPES else None,
    }


# ---------------------------------------------------------------------------
# Publisher: one long-lived connection, owned by one thread, publisher confirms
# ---------------------------------------------------------------------------


class _PublishJob:
    __slots__ = ("queue_name", "body", "headers", "future")

    def __init__(self, queue_name: str, body: bytes, headers: Dict[str, Any]):
        self.queue_name = queue_name
        self.body = body
        self.headers = headers
        self.future: concurrent.futures.Future = concurrent.futures.Future()


class RabbitPublisher:
    """Thread-confined pika publisher with confirms and automatic reconnect."""

    def __init__(self) -> None:
        self._jobs: "_queue.Queue[Optional[_PublishJob]]" = _queue.Queue()
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._conn: Optional[pika.BlockingConnection] = None
        self._chan = None
        self._declared: set = set()

    # -- lifecycle (called from the event loop thread) --
    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="rabbit-publisher", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._jobs.put(None)
        if self._thread:
            self._thread.join(timeout=5)

    def submit(self, queue_name: str, body: bytes, headers: Dict[str, Any]) -> concurrent.futures.Future:
        job = _PublishJob(queue_name, body, headers)
        if self._stop.is_set():
            job.future.set_exception(RuntimeError("publisher stopped"))
            return job.future
        self._jobs.put(job)
        return job.future

    @property
    def connected(self) -> bool:
        return bool(self._conn is not None and self._conn.is_open)

    # -- publisher thread --
    def _connect(self) -> None:
        self._close()
        params = pika.ConnectionParameters(
            host=RABBITMQ_HOST,
            port=RABBITMQ_PORT,
            credentials=pika.PlainCredentials(RABBITMQ_USER, RABBITMQ_PASSWORD),
            heartbeat=30,
            blocked_connection_timeout=10,
            connection_attempts=1,
            socket_timeout=5,
        )
        self._conn = pika.BlockingConnection(params)
        self._chan = self._conn.channel()
        self._chan.confirm_delivery()
        self._declared = set()
        logger.info("RabbitMQ publisher connected (%s:%s)", RABBITMQ_HOST, RABBITMQ_PORT)

    def _close(self) -> None:
        try:
            if self._conn is not None and self._conn.is_open:
                self._conn.close()
        except Exception:
            pass
        self._conn = None
        self._chan = None

    def _publish_once(self, job: _PublishJob) -> None:
        if not self.connected or self._chan is None or not self._chan.is_open:
            self._connect()
        if job.queue_name not in self._declared:
            self._chan.queue_declare(queue=job.queue_name, durable=True)
            self._declared.add(job.queue_name)
        # With confirm_delivery() this blocks until the broker acks, and raises
        # NackError / UnroutableError when it does not.
        self._chan.basic_publish(
            exchange="",
            routing_key=job.queue_name,
            body=job.body,
            properties=pika.BasicProperties(delivery_mode=2, headers=job.headers, content_type="application/json"),
            mandatory=True,
        )

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                job = self._jobs.get(timeout=1.0)
            except _queue.Empty:
                # Idle: service heartbeats so the broker keeps the connection.
                try:
                    if self.connected:
                        self._conn.process_data_events(time_limit=0)
                except Exception as e:
                    logger.warning("RabbitMQ publisher idle check failed, will reconnect: %s", e)
                    self._close()
                continue
            if job is None:
                break
            if job.future.done():  # caller already gave up (timeout)
                continue
            last_exc: Optional[BaseException] = None
            for attempt in range(2):  # one transparent reconnect on a dead connection
                try:
                    self._publish_once(job)
                    last_exc = None
                    break
                except Exception as e:
                    last_exc = e
                    logger.warning("RabbitMQ publish failed (attempt %d): %s", attempt + 1, e)
                    self._close()
                    if attempt == 0:
                        time.sleep(0.2)
            try:
                if not job.future.done():
                    if last_exc is None:
                        job.future.set_result(True)
                    else:
                        job.future.set_exception(last_exc)
            except concurrent.futures.InvalidStateError:
                pass  # the caller timed out / cancelled meanwhile
        # Drain: fail anything still waiting so callers return 5xx promptly.
        while True:
            try:
                job = self._jobs.get_nowait()
            except _queue.Empty:
                break
            if job is not None and not job.future.done():
                job.future.set_exception(RuntimeError("publisher stopped"))
        self._close()


publisher = RabbitPublisher()


@app.on_event("startup")
def _startup() -> None:
    try:
        from shared.obs import bootstrap
        bootstrap("webhook-handler")
    except Exception:
        pass
    if not VERIFY_TOKEN:
        logger.error("WEBHOOK_VERIFY_TOKEN is not set - webhook verification (GET /) will be refused")
    publisher.start()


@app.on_event("shutdown")
def _shutdown() -> None:
    publisher.stop()


def _build_body(topic: str, message_data: Dict[str, Any]) -> bytes:
    tagged_message = {
        **message_data,
        "topic": topic,
        "enqueued_at": datetime.utcnow().isoformat(),
    }
    # Stamp the correlation id so downstream workers (webhook-worker,
    # assistant-worker, contact-import) continue the same flow.
    try:
        from shared.obs import inject_into
        inject_into(tagged_message)
    except Exception:
        pass
    return json.dumps(tagged_message, ensure_ascii=False).encode("utf-8")


async def enqueue_to_rabbitmq(topic: str, message_data: Dict[str, Any], queue_name: Optional[str] = None) -> bool:
    """Durably enqueue one item. True only once the broker confirmed it."""
    target_queue = queue_name or WEBHOOK_QUEUE
    try:
        fut = publisher.submit(target_queue, _build_body(topic, message_data), {"topic": topic})
        await asyncio.wait_for(asyncio.wrap_future(fut), timeout=PUBLISH_TIMEOUT_S)
        logger.debug("Enqueued to %s topic=%s", target_queue, topic)
        return True
    except Exception as e:
        logger.error("Error enqueueing to RabbitMQ (%s, topic=%s): %s", target_queue, topic, e or type(e).__name__)
        return False


@app.get("/")
async def verify_webhook(request: Request):
    """Webhook verification endpoint for Meta. Fails closed when no token is configured."""
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token") or ""
    challenge = request.query_params.get("hub.challenge") or ""

    if VERIFY_TOKEN and mode == "subscribe" and hmac.compare_digest(token, VERIFY_TOKEN):
        logger.info("Webhook verified successfully")
        return Response(content=challenge, media_type="text/plain", status_code=200)
    logger.warning("Webhook verification failed%s", "" if VERIFY_TOKEN else " (WEBHOOK_VERIFY_TOKEN unset)")
    return Response(content="Forbidden", media_type="text/plain", status_code=403)


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "publisher_connected": publisher.connected,
        "timestamp": datetime.utcnow().isoformat(),
    }


def _plan_change(value: Dict[str, Any]) -> Tuple[List[Tuple[str, Dict[str, Any], Optional[str]]], int]:
    """Turn one webhook `change.value` into (topic, payload, queue) publish jobs.

    Returns (jobs, ignored_count).
    """
    jobs: List[Tuple[str, Dict[str, Any], Optional[str]]] = []
    ignored = 0
    wa_phone_number_id = (value.get("metadata") or {}).get("phone_number_id")
    now = datetime.utcnow().isoformat()

    for status in value.get("statuses") or []:
        if not isinstance(status, dict) or not status.get("id"):
            ignored += 1
            continue
        logger.info("Webhook status update | id=%s status=%s", status.get("id"), status.get("status"))
        jobs.append((
            "status.update",
            {
                "event_id": status.get("event_id"),
                "recipient": status.get("recipient_id"),
                "guest_phone": status.get("recipient_id"),
                "message_type": "status.update",
                "payload": status,
                "wa_message_id": status.get("id"),
                "wa_phone_number_id": wa_phone_number_id,
                "received_at": now,
            },
            None,
        ))

    for message in value.get("messages") or []:
        if not isinstance(message, dict) or not message.get("id") or not message.get("from"):
            ignored += 1
            continue
        message_id = message.get("id")
        sender = message.get("from")
        category = categorize_message(message)
        # SECURITY: log id + type only - never sender phone or body.
        logger.info("Webhook inbound message | id=%s type=%s from=%s routed=%s",
                    message_id, message.get("type"), mask_phone(sender), bool(category))
        if category is None:
            ignored += 1
            continue

        if category == "contacts":
            # FULL original message to contact_import_queue (message_id = idempotency key).
            jobs.append((
                "contact_import",
                {
                    "message_id": message_id,
                    "sender_phone": sender,
                    "raw_message": message,
                    "wa_phone_number_id": wa_phone_number_id,
                    "received_at": now,
                },
                CONTACT_IMPORT_QUEUE,
            ))
            continue

        route = route_inbound_message(wa_phone_number_id)
        if route == "drop":
            ignored += 1
            logger.info("Dropping message %s received on no-reply OTP number", message_id)
            continue
        jobs.append((
            category,
            {
                "event_id": message_id,
                "recipient": sender,
                "message_id": message_id,
                "reply_to_message_id": (message.get("context") or {}).get("id"),
                "type": category,
                "wa_phone_number_id": wa_phone_number_id,
                "payload": {**message, "extracted_data": extract_message_data(message, category)},
                "received_at": now,
            },
            route,
        ))
    return jobs, ignored


@app.post("/")
async def handle_whatsapp_webhook(request: Request):
    body = await request.body()
    # SECURITY: never log request headers (carry the Meta signature) or the full
    # body (guest PII) at INFO.
    logger.debug("Webhook received (%d bytes)", len(body))

    signature = request.headers.get("X-Hub-Signature-256", "")
    if not verify_webhook_signature(body, signature, WEBHOOK_SECRET):
        logger.warning("Invalid webhook signature")
        raise HTTPException(status_code=400, detail="Invalid signature")

    try:
        data = json.loads(body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        logger.error("Invalid JSON payload")
        raise HTTPException(status_code=400, detail="Invalid JSON")

    if not isinstance(data, dict) or not validate_whatsapp_message(data):
        raise HTTPException(status_code=400, detail="Invalid message schema")

    jobs: List[Tuple[str, Dict[str, Any], Optional[str]]] = []
    ignored = 0
    for entry in data.get("entry") or []:
        for change in (entry.get("changes") or []) if isinstance(entry, dict) else []:
            value = (change or {}).get("value") or {}
            if not isinstance(value, dict):
                continue
            wa_phone_number_id = (value.get("metadata") or {}).get("phone_number_id")
            n_msgs, n_stat = len(value.get("messages") or []), len(value.get("statuses") or [])
            logger.info("Webhook change | phone_number_id=%s messages=%d statuses=%d",
                        wa_phone_number_id, n_msgs, n_stat)
            try:
                from shared.obs import log_event, set_whatsapp
                set_whatsapp(phone_number_id=wa_phone_number_id)
                log_event("webhook.received", messages=n_msgs, statuses=n_stat)
            except Exception:
                pass
            change_jobs, change_ignored = _plan_change(value)
            jobs.extend(change_jobs)
            ignored += change_ignored

    results = await asyncio.gather(*(enqueue_to_rabbitmq(t, p, q) for t, p, q in jobs)) if jobs else []
    failed = sum(1 for ok in results if not ok)
    if failed:
        # Meta retries non-2xx deliveries; downstream dedupes by wamid, so the
        # items that DID enqueue are safe to receive twice.
        logger.error("Webhook enqueue failed for %d/%d item(s) - returning 503 so Meta retries",
                     failed, len(jobs))
        return JSONResponse(status_code=503, content={"message": "Temporarily unavailable", "failed": failed})

    return JSONResponse(
        status_code=200,
        content={
            "message": "Messages processed successfully",
            "processed_count": len(jobs),
            "ignored_count": ignored,
            "timestamp": datetime.utcnow().isoformat(),
        },
    )


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=PORT,
        reload=False,  # never run the file-watching reloader in production
        log_level="info",
    )
