"""
RabbitMQ consumer for Outpost Service.

Two lanes, each with its own channel, prefetch and concurrency budget:

    campaign  OUTPOST_QUEUE_NAME       bulk campaign traffic (campaign-worker,
                                       scheduler) - may hold a large backlog.
    priority  OUTPOST_PRIORITY_QUEUE   interactive / owner-facing traffic
                                       (webhook-worker bot replies, assistant,
                                       contact import, owner notifications).

Because the priority lane has its own channel + semaphore and takes precedence in
the shared per-number token bucket, a guest who taps "coming" is answered in
seconds even while 10,000 campaign messages are queued.

Per message:
  1. breaker gate     account-level Meta failure (token/account) stops sending.
  2. idempotent claim campaign messages claim messages_sent.send_claimed_at
                      before calling Meta, so a crash/requeue never double-sends.
  3. token bucket     per phone_number_id, under Meta's ~80 mps.
  4. send             shared keep-alive httpx client.
  5. outcome          accepted -> messages_sent + messages_log;
                      retryable Meta codes -> delayed retry queues (backoff +
                      jitter, max OUTPOST_MAX_ATTEMPTS) then failed;
                      template codes -> per-template breaker + retry;
                      account codes -> circuit breaker (campaign consumer
                      cancelled, in-flight requeued, ops paged, probe / 5 min).

All psycopg2 work runs on the DB thread pool (never on the event loop).

Queues (all durable). The main queues keep their original arguments (none) -
re-declaring an existing queue with different arguments fails with
PRECONDITION_FAILED, so DLX behaviour lives on NEW queues only:

    <q>.retry.<n>   x-message-ttl + x-dead-letter-exchange "" ->
                    x-dead-letter-routing-key <q>   (delay tier n)
    <q>.dlq         poison / exhausted messages, for inspection
"""

import asyncio
import json
import logging
import os
import random
import time
from typing import Any, Dict, List, Optional

import aio_pika
from aio_pika import Message, DeliveryMode
from aio_pika.abc import AbstractIncomingMessage
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

import meta_errors
from meta_errors import MetaSendError
from breaker import CircuitBreaker, KeyedBreakers, HALF_OPEN
from throttle import BucketRegistry
from whatsapp_sender import WhatsAppSender
from db_utils import (
    get_conversation_db, CLAIM_OK, CLAIM_DONE, CLAIM_BUSY, CLAIM_UNCERTAIN, CLAIM_MISSING,
)
from utils.phone import mask_phone
from shared.domain.delivery import MessageDeliveryStatus

ATTEMPT_HEADER = "x-outpost-attempt"

# Campaign stages whose guest replies must be handled by the RSVP flow. A
# reminder sent to a guest whose conversation sits in rsvp_decline/rsvp_done
# used to be logged with THAT state, so tapping "coming" on the reminder fell
# into the "didn't understand" loop (review 3.6).
_RSVP_STAGE_PREFIXES = (
    "invitation", "reminder", "final_reminder", "rsvp", "general_rsvp",
    "event_no_pic", "nudge_reminder", "event_remind",
)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def _env_delays(name: str, default: str) -> List[float]:
    raw = os.getenv(name) or default
    out = []
    for part in raw.split(","):
        part = part.strip()
        if part:
            try:
                out.append(max(1.0, float(part)))
            except ValueError:
                pass
    return out or [float(x) for x in default.split(",")]


def campaign_log_state(data: Dict[str, Any]) -> Optional[str]:
    """The conversation state to log for a campaign message, or None to keep the
    conversation's current state. campaign-worker sends `log_state` explicitly;
    the stage-name fallback covers messages enqueued before that rollout."""
    if data.get("log_state"):
        return str(data["log_state"])
    stage = str(data.get("stage") or data.get("state") or "").strip().lower()
    if stage and stage.startswith(_RSVP_STAGE_PREFIXES):
        return "rsvp_invite"
    return None


# --- observability helpers (best-effort; never break a send) ----------------
def _obs_adopt(message_data: dict) -> None:
    try:
        from shared.obs import adopt_from, clear_context, set_flow, set_whatsapp, set_campaign
        clear_context()
        adopt_from(message_data)
        set_flow(worker="outpost", flow="whatsapp",
                 operation=message_data.get("message_type", "template"))
        set_whatsapp(recipient=mask_phone(message_data.get("recipient")),
                     template=message_data.get("template"),
                     language=message_data.get("language"),
                     phone_number_id=message_data.get("wa_phone_number_id"),
                     conversation_id=message_data.get("conversation_id"))
        if message_data.get("campaign_id"):
            set_campaign(campaign_id=message_data.get("campaign_id"))
    except Exception:
        pass


def _obs_wa(**fields) -> None:
    try:
        from shared.obs import set_whatsapp
        set_whatsapp(**fields)
    except Exception:
        pass


class Lane:
    """One consumed queue with its own channel, prefetch and concurrency."""

    def __init__(self, name: str, queue_name: str, prefetch: int, concurrency: int,
                 priority: bool, retry_delays: List[float]):
        self.name = name
        self.queue_name = queue_name
        self.prefetch = max(1, prefetch)
        self.semaphore = asyncio.Semaphore(max(1, concurrency))
        self.priority = priority
        self.retry_delays = retry_delays
        self.channel = None
        self.queue = None
        self.consumer_tag: Optional[str] = None
        self.paused = False

    def retry_queue(self, attempt: int) -> str:
        tier = min(max(attempt, 1), len(self.retry_delays))
        return f"{self.queue_name}.retry.{tier}"

    def retry_delay(self, attempt: int) -> float:
        base = self.retry_delays[min(max(attempt, 1), len(self.retry_delays)) - 1]
        return base * random.uniform(0.8, 1.2)        # jitter: no thundering herd

    @property
    def dlq(self) -> str:
        return f"{self.queue_name}.dlq"


class RabbitMQConsumer:
    """Consumes the campaign + priority outpost queues and sends via Meta."""

    def __init__(self):
        self.logger = logging.getLogger("rabbit_consumer")
        self.connection = None
        self.publish_channel = None
        self.whatsapp_sender = WhatsAppSender()
        self.running = False

        self.host = os.getenv("RABBITMQ_HOST")
        self.port = int(os.getenv("RABBITMQ_PORT"))
        self.user = os.getenv("RABBITMQ_USER")
        self.password = os.getenv("RABBITMQ_PASSWORD")

        self.max_attempts = max(1, _env_int("OUTPOST_MAX_ATTEMPTS", 5))
        prefetch = _env_int("OUTPOST_PREFETCH", 20)
        prio_prefetch = _env_int("OUTPOST_PRIORITY_PREFETCH", 10)
        self.campaign = Lane(
            "campaign", os.getenv("OUTPOST_QUEUE_NAME") or "outpost_queue",
            prefetch, _env_int("OUTPOST_CONCURRENCY", prefetch), priority=False,
            retry_delays=_env_delays("OUTPOST_RETRY_DELAYS", "30,120,480,1200,2400"),
        )
        self.priority = Lane(
            "priority", os.getenv("OUTPOST_PRIORITY_QUEUE") or "outpost_priority_queue",
            prio_prefetch, _env_int("OUTPOST_PRIORITY_CONCURRENCY", prio_prefetch), priority=True,
            retry_delays=_env_delays("OUTPOST_PRIORITY_RETRY_DELAYS", "2,10,30,120,300"),
        )
        self.lanes = (self.campaign, self.priority)
        # Backwards compat for anything reading these attributes.
        self.queue_name = self.campaign.queue_name

        mps = float(os.getenv("OUTPOST_MAX_MPS", "40"))
        burst = os.getenv("OUTPOST_BURST")
        self.buckets = BucketRegistry(mps, float(burst) if burst else None)

        probe = float(os.getenv("OUTPOST_BREAKER_PROBE_SECONDS", "300"))
        self.breaker = CircuitBreaker(probe_interval=probe)
        self.template_breakers = KeyedBreakers(probe_interval=probe)

        self.conversation_db = get_conversation_db()
        self._tasks: set = set()
        # Sentry aggregation: one event per (campaign, error_code, template) per hour.
        self._reported: Dict[tuple, float] = {}
        self._stats = {"accepted": 0, "failed": 0, "retried": 0, "requeued": 0, "skipped": 0}

    # ----------------------------------------------------------------- infra
    async def _db(self, fn, *args, **kwargs):
        """Run a synchronous DB helper on the DB thread pool."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            self.conversation_db.executor, lambda: fn(*args, **kwargs))

    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        retry=retry_if_exception_type((aio_pika.exceptions.AMQPConnectionError, ConnectionError, OSError))
    )
    async def connect(self):
        """Connect, open one channel per lane + a publish channel, declare queues."""
        connection_url = f"amqp://{self.user}:{self.password}@{self.host}:{self.port}/"
        self.logger.info(f"Connecting to RabbitMQ at {self.host}:{self.port}")
        self.connection = await aio_pika.connect_robust(
            connection_url, heartbeat=60, blocked_connection_timeout=300)
        self.publish_channel = await self.connection.channel()
        for lane in self.lanes:
            lane.channel = await self.connection.channel()
            await lane.channel.set_qos(prefetch_count=lane.prefetch)
            # Main queue: plain durable, arguments UNCHANGED (see module doc).
            # Producers must declare it identically (durable=True, no arguments).
            lane.queue = await lane.channel.declare_queue(lane.queue_name, durable=True)
            await self._declare_retry_topology(lane)
        self.logger.info("Connected to RabbitMQ", extra={
            "campaign_queue": self.campaign.queue_name, "priority_queue": self.priority.queue_name,
            "prefetch": self.campaign.prefetch, "priority_prefetch": self.priority.prefetch,
        })

    async def _declare_retry_topology(self, lane: Lane) -> None:
        for i, delay in enumerate(lane.retry_delays, start=1):
            await self.publish_channel.declare_queue(
                f"{lane.queue_name}.retry.{i}", durable=True,
                arguments={
                    # Upper bound; each message also carries its own jittered
                    # (<= 1.2x) expiration. Expired -> dead-lettered to the main queue.
                    "x-message-ttl": int(delay * 1000 * 1.25),
                    "x-dead-letter-exchange": "",
                    "x-dead-letter-routing-key": lane.queue_name,
                },
            )
        await self.publish_channel.declare_queue(
            lane.dlq, durable=True, arguments={"x-max-length": 100000})

    async def _publish(self, routing_key: str, body: bytes, headers: Dict[str, Any],
                       expiration: Optional[float] = None) -> None:
        msg = Message(body, delivery_mode=DeliveryMode.PERSISTENT, headers=headers,
                      expiration=expiration)
        await self.publish_channel.default_exchange.publish(msg, routing_key=routing_key)

    async def _start_lane(self, lane: Lane, prefetch: Optional[int] = None) -> None:
        if lane.consumer_tag:
            if prefetch:
                await lane.channel.set_qos(prefetch_count=prefetch)
            return
        await lane.channel.set_qos(prefetch_count=prefetch or lane.prefetch)
        lane.consumer_tag = await lane.queue.consume(
            lambda m, _l=lane: self._dispatch(_l, m), no_ack=False)
        lane.paused = False
        self.logger.info(f"Consuming {lane.name} lane", extra={"queue": lane.queue_name,
                                                              "prefetch": prefetch or lane.prefetch})

    async def _pause_lane(self, lane: Lane) -> None:
        lane.paused = True
        tag, lane.consumer_tag = lane.consumer_tag, None
        if tag:
            try:
                await lane.queue.cancel(tag)
            except Exception as e:
                self.logger.warning(f"Failed to cancel {lane.name} consumer: {e}")
        self.logger.warning(f"Paused {lane.name} lane (circuit breaker open)")

    # ------------------------------------------------------------- consuming
    async def _dispatch(self, lane: Lane, message: AbstractIncomingMessage) -> None:
        """Consumer callback: hand off to a task so deliveries run concurrently
        (bounded by prefetch + the lane semaphore)."""
        task = asyncio.create_task(self._handle(lane, message))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _handle(self, lane: Lane, message: AbstractIncomingMessage) -> None:
        async with lane.semaphore:
            try:
                await self._process(lane, message)
            except Exception as e:
                self.logger.error(f"Unexpected error processing outpost message: {e}", exc_info=True)
                try:
                    from shared.obs import capture
                    capture(e, operation="outpost_process", flow="whatsapp", worker="outpost")
                except Exception:
                    pass
                await self._settle_requeue(message, delay=1.0)

    async def _settle_ack(self, message) -> None:
        try:
            await message.ack()
        except Exception as e:
            self.logger.warning(f"ack failed: {e}")

    async def _settle_requeue(self, message, delay: float = 0.0) -> None:
        if delay:
            await asyncio.sleep(delay)
        try:
            await message.nack(requeue=True)
            self._stats["requeued"] += 1
        except Exception as e:
            self.logger.warning(f"nack failed: {e}")

    async def _to_dlq(self, lane: Lane, message, reason: str) -> None:
        headers = dict(message.headers or {})
        headers["x-outpost-dlq-reason"] = reason[:200]
        try:
            await self._publish(lane.dlq, message.body, headers)
        except Exception as e:
            self.logger.error(f"Failed to publish to DLQ: {e}")

    @staticmethod
    def _validate(data: Dict[str, Any]) -> Optional[str]:
        mtype = data.get("message_type", "template")
        required = {
            "template": ["recipient", "template", "parameters"],
            "free_text": ["recipient", "text"],
            "interactive": ["recipient", "interactive"],
        }.get(mtype)
        if required is None:
            return f"unknown message_type {mtype}"
        missing = [f for f in required if f not in data]
        return f"missing fields {missing}" if missing else None

    async def _process(self, lane: Lane, message: AbstractIncomingMessage) -> None:
        try:
            data = json.loads(message.body.decode())
            if not isinstance(data, dict):
                raise ValueError("message body is not an object")
        except Exception as e:
            self.logger.error(f"Unparseable outpost message: {e}")
            await self._to_dlq(lane, message, "unparseable")
            await self._settle_ack(message)
            return

        headers = message.headers or {}
        try:
            attempt = int(headers.get(ATTEMPT_HEADER) or 0)
        except (TypeError, ValueError):
            attempt = 0
        _obs_adopt(data)

        if data.get("platform") != "WA":
            self.logger.warning("Unsupported platform, skipping", extra={"platform": data.get("platform")})
            await self._settle_ack(message)
            return

        mtype = data.get("message_type", "template")
        campaign_id = data.get("campaign_id")
        guest_id = data.get("guest_id")
        problem = self._validate(data)
        if problem:
            self.logger.error(f"Invalid outpost message: {problem}",
                              extra={"campaign_id": campaign_id, "message_type": mtype})
            await self._db(self.conversation_db.record_delivery_outcome, campaign_id, guest_id,
                           MessageDeliveryStatus.FAILED.value, None, "invalid_message", problem)
            await self._to_dlq(lane, message, problem)
            await self._settle_ack(message)
            return

        template_key = data.get("template") if mtype == "template" else None

        # 1. Account-level breaker.
        if not self.breaker.allow():
            await self._defer_breaker_open(lane, message, attempt)
            return
        holds_probe = self.breaker.state == HALF_OPEN

        # 1b. Per-template breaker (template missing / paused / disabled).
        if template_key and not self.template_breakers.allow(template_key):
            if holds_probe:
                self.breaker.release_probe()
            err = MetaSendError(kind=meta_errors.TEMPLATE,
                                error_code=self.template_breakers.reason(template_key) or "template_unavailable",
                                detail="template breaker open")
            await self._retry_or_fail(lane, message, data, attempt, err)
            return
        holds_template_probe = self.template_breakers.in_half_open(template_key)

        def _release_probes():
            if holds_probe:
                self.breaker.release_probe()
            if holds_template_probe:
                self.template_breakers.release_probe(template_key)

        # 2. Idempotent claim (campaign messages only).
        claim = CLAIM_MISSING
        if campaign_id and guest_id:
            claim = await self._db(self.conversation_db.claim_send, campaign_id, guest_id)
            if claim == CLAIM_DONE:
                _release_probes()
                self._stats["skipped"] += 1
                self.logger.info("Campaign message already resolved; not resending",
                                 extra={"campaign_id": campaign_id, "guest_id": guest_id})
                await self._settle_ack(message)
                return
            if claim == CLAIM_BUSY:
                # Another copy is mid-send. Look again later (its outcome will
                # resolve the row, turning this into CLAIM_DONE).
                _release_probes()
                err = MetaSendError(kind=meta_errors.RETRYABLE, error_code="send_in_progress",
                                    detail="another delivery holds the send claim")
                await self._retry_or_fail(lane, message, data, attempt, err)
                return
            if claim == CLAIM_UNCERTAIN:
                _release_probes()
                await self._db(self.conversation_db.record_delivery_outcome, campaign_id, guest_id,
                               MessageDeliveryStatus.FAILED.value, None, "send_uncertain",
                               "send was interrupted twice; not resent to avoid a duplicate")
                self._stats["failed"] += 1
                await self._settle_ack(message)
                return

        # 3. Throughput governor (priority lane takes precedence).
        sender = data.get("sender")
        await self.buckets.acquire(self.whatsapp_sender.phone_id_for(sender), priority=lane.priority)
        if not self.breaker.is_closed and not holds_probe:
            # Breaker tripped while we waited for a token.
            if claim == CLAIM_OK:
                await self._db(self.conversation_db.release_send_claim, campaign_id, guest_id)
            if holds_template_probe:
                self.template_breakers.release_probe(template_key)
            await self._defer_breaker_open(lane, message, attempt)
            return

        # 4. Send.
        try:
            if mtype == "template":
                wa_resp = await self.whatsapp_sender.send_template_message(
                    recipient=data["recipient"], template_name=data["template"],
                    parameters=data["parameters"], language=data.get("language"), sender=sender)
            elif mtype == "free_text":
                wa_resp = await self.whatsapp_sender.send_text_message(
                    recipient=data["recipient"], text=data["text"], sender=sender)
            else:
                wa_resp = await self.whatsapp_sender.send_interactive_message(
                    recipient=data["recipient"], interactive=data["interactive"], sender=sender)
        except MetaSendError as err:
            await self._on_send_error(lane, message, data, attempt, err, claim, template_key,
                                      holds_probe, holds_template_probe)
            return

        # 5. Success.
        if self.breaker.record_success():
            await self._on_breaker_closed()
        if template_key:
            self.template_breakers.record_success(template_key)
        wa_id = ((wa_resp or {}).get("messages") or [{}])[0].get("id")
        if campaign_id and guest_id:
            # Meta took the message: THIS is what "sent" means, not the enqueue.
            await self._db(self.conversation_db.record_delivery_outcome, campaign_id, guest_id,
                           MessageDeliveryStatus.ACCEPTED.value, wa_id)
        _obs_wa(message_id=wa_id, delivery_status="accepted")
        if wa_id:
            try:
                await self._db(self._bookkeep, data, wa_id, mtype)
            except Exception as e:
                self.logger.error(f"messages_log bookkeeping failed: {e}")
        else:
            self.logger.warning("No WhatsApp message id in response; not logged to messages_log")
        self._stats["accepted"] += 1
        self.logger.info("Message accepted by Meta", extra={
            "lane": lane.name, "message_type": mtype, "recipient": mask_phone(data.get("recipient")),
            "template": template_key, "campaign_id": campaign_id, "wa_message_id": wa_id,
            "attempt": attempt, "source": data.get("source", "unknown"),
        })
        await self._settle_ack(message)

    # ---------------------------------------------------------- bookkeeping
    def _bookkeep(self, data: Dict[str, Any], wa_id: str, mtype: str) -> None:
        """(DB thread) Ensure the conversation and log the outgoing message."""
        db = self.conversation_db
        conversation_id = data.get("conversation_id")
        if not conversation_id:
            # New conversations always start in rsvp_invite. The message's
            # "state" field is the template key, not a conversation state.
            conversation_id = db.ensure_or_get_conversation(
                event_id=data.get("event_id"), guest_phone=data.get("recipient"),
                guest_id=data.get("guest_id"), initial_state="rsvp_invite")
        if not conversation_id:
            return
        state = campaign_log_state(data) if data.get("campaign_id") else None
        if not state:
            current = db.get_conversation_state(conversation_id)
            if mtype == "template":
                state = current or "rsvp_invite"
            else:
                state = current or data.get("state") or "rsvp_invite"
        db.log_outgoing_message(
            conversation_id=conversation_id, message_type=mtype, state=state,
            whatsapp_message_id=wa_id,
            payload=json.dumps(data, ensure_ascii=False)[:4000],
            campaign_id=data.get("campaign_id"),
            guest_phone=data.get("recipient"),
        )

    # ------------------------------------------------------- failure paths
    async def _defer_breaker_open(self, lane: Lane, message, attempt: int) -> None:
        if lane is self.campaign:
            # Back to the queue untouched; the consumer is being cancelled so it
            # will not bounce back to us until the breaker probes.
            await self._settle_requeue(message, delay=0.5)
        else:
            # Interactive traffic is not parked indefinitely: bounded retries.
            data = {}
            try:
                data = json.loads(message.body.decode())
            except Exception:
                pass
            err = MetaSendError(kind=meta_errors.RETRYABLE, error_code=self.breaker.reason or "breaker_open",
                                detail="circuit breaker open")
            await self._retry_or_fail(lane, message, data, attempt, err)

    async def _on_send_error(self, lane: Lane, message, data, attempt: int, err: MetaSendError,
                             claim: str, template_key: Optional[str],
                             holds_probe: bool, holds_template_probe: bool) -> None:
        campaign_id, guest_id = data.get("campaign_id"), data.get("guest_id")
        _obs_wa(meta_error_code=err.error_code, meta_error_message=err.detail[:200],
                delivery_status="failed")

        if err.kind == meta_errors.ACCOUNT:
            if claim == CLAIM_OK:
                await self._db(self.conversation_db.release_send_claim, campaign_id, guest_id)
            if holds_template_probe:
                self.template_breakers.release_probe(template_key)
            opened = self.breaker.record_failure(err.error_code)
            if opened:
                await self._on_breaker_opened(err)
            elif not self.campaign.paused:
                # A failed half-open probe: stop the prefetch=1 probe consumer
                # again (otherwise it would bounce requeued messages in a loop).
                await self._pause_lane(self.campaign)
            if lane is self.campaign:
                await self._settle_requeue(message, delay=0.5)
            else:
                await self._retry_or_fail(lane, message, data, attempt, err)
            return

        # Any non-account answer from Meta proves the account/token works.
        if not self.breaker.is_closed and self.breaker.record_success():
            await self._on_breaker_closed()
        elif holds_probe:
            self.breaker.release_probe()

        if err.kind == meta_errors.TEMPLATE and template_key:
            if self.template_breakers.record_failure(template_key, err.error_code):
                await self._alert_critical(
                    f"WhatsApp template '{template_key}' unavailable ({err.error_code}): {err.detail[:200]}",
                    error_type="meta_template_unavailable",
                    context={"template": template_key, "error_code": err.error_code})
            if claim == CLAIM_OK:
                await self._db(self.conversation_db.release_send_claim, campaign_id, guest_id)
            await self._retry_or_fail(lane, message, data, attempt, err)
            return

        if holds_template_probe:
            self.template_breakers.record_success(template_key)

        if err.kind == meta_errors.RETRYABLE:
            if claim == CLAIM_OK:
                await self._db(self.conversation_db.release_send_claim, campaign_id, guest_id)
            await self._retry_or_fail(lane, message, data, attempt, err)
            return

        # PERMANENT: this message can never succeed.
        await self._fail(lane, message, data, err)

    async def _retry_or_fail(self, lane: Lane, message, data, attempt: int, err: MetaSendError) -> None:
        nxt = attempt + 1
        if nxt >= self.max_attempts:
            await self._fail(lane, message, data, err, exhausted=True)
            return
        headers = dict(message.headers or {})
        headers[ATTEMPT_HEADER] = nxt
        headers["x-outpost-last-error"] = err.error_code[:100]
        delay = lane.retry_delay(nxt)
        try:
            await self._publish(lane.retry_queue(nxt), message.body, headers, expiration=delay)
        except Exception as e:
            self.logger.error(f"Failed to schedule retry; requeueing: {e}")
            await self._settle_requeue(message, delay=1.0)
            return
        self._stats["retried"] += 1
        self.logger.info("Scheduled retry", extra={
            "lane": lane.name, "attempt": nxt, "delay_s": round(delay, 1),
            "error_code": err.error_code, "campaign_id": data.get("campaign_id"),
            "recipient": mask_phone(data.get("recipient")),
        })
        await self._settle_ack(message)

    async def _fail(self, lane: Lane, message, data, err: MetaSendError, exhausted: bool = False) -> None:
        campaign_id, guest_id = data.get("campaign_id"), data.get("guest_id")
        if campaign_id and guest_id:
            await self._db(self.conversation_db.record_delivery_outcome, campaign_id, guest_id,
                           MessageDeliveryStatus.FAILED.value, None, err.error_code,
                           ("retries exhausted: " if exhausted else "") + err.detail)
        else:
            # Non-campaign traffic has no DB row; keep it for inspection.
            await self._to_dlq(lane, message, f"{err.error_code}{' (exhausted)' if exhausted else ''}")
        self._stats["failed"] += 1
        self._report_rejection(data, err)
        self.logger.warning("Message failed", extra={
            "lane": lane.name, "error_code": err.error_code, "exhausted": exhausted,
            "campaign_id": campaign_id, "recipient": mask_phone(data.get("recipient")),
            "template": data.get("template"),
        })
        await self._settle_ack(message)

    def _report_rejection(self, data, err: MetaSendError) -> None:
        """Sentry, aggregated: once per (campaign, error_code, template) per hour
        instead of one event per guest (a bad template on a 300-guest round used
        to produce 300 events)."""
        key = (data.get("campaign_id") or "-", err.error_code, data.get("template") or "-")
        now = time.monotonic()
        if now - self._reported.get(key, -1e9) < 3600:
            return
        self._reported[key] = now
        if len(self._reported) > 5000:
            cutoff = now - 3600
            self._reported = {k: v for k, v in self._reported.items() if v >= cutoff}
        try:
            from shared.obs import set_external, capture_message
            set_external(provider="meta", endpoint="/messages", status_code=err.status_code)
            capture_message(f"Meta rejected message ({err.error_code})", level="warning",
                            meta_error_code=err.error_code)
        except Exception:
            pass

    # ------------------------------------------------------- circuit breaker
    async def _alert_critical(self, message: str, *, error_type: str, context: dict) -> None:
        self.logger.critical(message, extra=context)
        try:
            from shared.obs import capture_message
            capture_message(message, level="fatal", meta_error_code=context.get("error_code"))
        except Exception:
            pass
        try:
            from shared.ops.errors import record_error, SEVERITY_CRITICAL
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(
                self.conversation_db.executor,
                lambda: record_error("outpost", message, severity=SEVERITY_CRITICAL,
                                     error_type=error_type, context=context))
        except Exception:
            pass

    async def _on_breaker_opened(self, err: MetaSendError) -> None:
        await self._pause_lane(self.campaign)
        await self._alert_critical(
            f"WhatsApp account-level failure ({err.error_code}) - campaign sending STOPPED; "
            f"probing every {int(self.breaker.probe_interval)}s. {err.detail[:200]}",
            error_type="meta_account_blocked",
            context={"error_code": err.error_code, "status_code": err.status_code})

    async def _on_breaker_closed(self) -> None:
        self.logger.warning("Circuit breaker closed - Meta accepting again; resuming campaign lane")
        try:
            await self._start_lane(self.campaign, prefetch=self.campaign.prefetch)
        except Exception as e:
            self.logger.error(f"Failed to resume campaign lane: {e}")
        try:
            from shared.ops.errors import record_error, SEVERITY_INFO
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(
                self.conversation_db.executor,
                lambda: record_error("outpost", "WhatsApp sending resumed (breaker closed)",
                                     severity=SEVERITY_INFO, error_type="meta_account_recovered"))
        except Exception:
            pass

    async def _monitor(self) -> None:
        """Probe scheduling + periodic stats."""
        last_stats = time.monotonic()
        while self.running:
            await asyncio.sleep(5)
            try:
                if self.campaign.paused and self.breaker.probe_due():
                    # Half-open: let ONE campaign message through (prefetch 1).
                    self.logger.warning("Circuit breaker probe: resuming campaign lane with prefetch=1")
                    await self._start_lane(self.campaign, prefetch=1)
                if time.monotonic() - last_stats >= 60:
                    last_stats = time.monotonic()
                    self.logger.info("outpost stats", extra={
                        **self._stats, "in_flight": len(self._tasks),
                        "breaker": self.breaker.state, "campaign_paused": self.campaign.paused,
                    })
            except Exception as e:
                self.logger.error(f"monitor error: {e}")

    # ------------------------------------------------------------ lifecycle
    async def start_consuming(self):
        if not self.connection:
            await self.connect()
        ok = await self._db(self.conversation_db.ensure_schema)
        if self.conversation_db.enabled and not ok:
            self.logger.error("Send-claim schema not ensured; campaign sends will retry claim on demand")
        self.running = True
        await self._start_lane(self.priority)
        await self._start_lane(self.campaign)
        monitor = asyncio.create_task(self._monitor())
        try:
            while self.running:
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            self.logger.info("Consumer cancelled")
        finally:
            monitor.cancel()

    async def stop(self):
        """Stop consuming; let in-flight sends finish (bounded)."""
        self.logger.info("Stopping message consumption...")
        for lane in self.lanes:
            if lane.consumer_tag:
                try:
                    await lane.queue.cancel(lane.consumer_tag)
                except Exception:
                    pass
                lane.consumer_tag = None
        if self._tasks:
            await asyncio.wait(list(self._tasks), timeout=20)
        self.running = False

    async def close(self):
        for ch in [self.publish_channel] + [l.channel for l in self.lanes]:
            try:
                if ch and not ch.is_closed:
                    await ch.close()
            except Exception:
                pass
        if self.connection and not self.connection.is_closed:
            await self.connection.close()
        await self.whatsapp_sender.aclose()
        self.conversation_db.close()
        self.logger.info("RabbitMQ connection closed")
