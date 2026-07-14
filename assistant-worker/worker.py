"""
Assistant Worker

Consumes inbound WhatsApp messages that arrived on the ASSISTANT business
number (assistant_inbound_queue, filled by webhook-hendler) and answers them
with the AI event assistant.

Authorization: the sender phone must belong to a registered user who OWNS at
least one active event - anyone else gets a polite refusal. The worker mints
a short-lived JWT for that user and calls core-service POST /assistant, so
RBAC and the audited tool registry are enforced by the exact same code path
as the web widget. (The assistant is included in every plan.)

Event scoping: one active owned event -> used implicitly. Several -> a
quick-reply / list picker is sent and the choice is remembered for a few
hours (assist:ctx). The same evsel:* picker also finishes a pending WhatsApp
contact import: contact-import-worker parks contacts in Redis (ci:pending)
and this worker sends back a "finalize_import" instruction with the chosen
event once the owner taps a button.
"""

import json
import logging
import os
import time
from typing import Any, Dict, List, Optional

import httpx
import jwt as pyjwt
import redis

import db
import mq

ASSISTANT_INBOUND_QUEUE = os.getenv("ASSISTANT_INBOUND_QUEUE", "assistant_inbound_queue")
OUTPOST_QUEUE = os.getenv("OUTPOST_QUEUE_NAME", "outpost_queue")
CONTACT_IMPORT_QUEUE = os.getenv("CONTACT_IMPORT_QUEUE", "contact_import_queue")
CORE_SERVICE_URL = os.getenv("CORE_SERVICE_URL", "http://core-service:8000")
JWT_SECRET = os.getenv("JWT_SECRET")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

# Ignore backlog older than the WhatsApp 24h customer-service window - a
# free-text reply outside it fails anyway.
MAX_MESSAGE_AGE_SECONDS = int(os.getenv("MAX_MESSAGE_AGE_SECONDS", "86400"))
ASSISTANT_HTTP_TIMEOUT = float(os.getenv("ASSISTANT_HTTP_TIMEOUT", "90"))
EVENT_CTX_TTL_SECONDS = 6 * 3600
PENDING_QUESTION_TTL_SECONDS = 15 * 60
HISTORY_TTL_SECONDS = 24 * 3600
MAX_HISTORY_MESSAGES = 20

MSG_NOT_REGISTERED = "היי! המספר הזה לא מזוהה אצלנו במערכת ShowUp, אז אני לא יכולה לעזור כאן 😅"
MSG_NO_ACTIVE_EVENT = "לא מצאתי אירוע פעיל בבעלותך. ברגע שיהיה לך אירוע פעיל במערכת - אשמח לעזור! 🙂"
MSG_TEXT_ONLY = "כרגע אני יודעת לטפל בהודעות טקסט ובאנשי קשר בלבד 🙂"
MSG_EVENT_GONE = "האירוע הזה כבר לא זמין. שלחו לי הודעה חדשה ונתחיל מההתחלה 🙂"
MSG_BUSY = "אני קצת עמוסה כרגע 😅 נסו שוב בעוד רגע"
MSG_ERROR = "משהו השתבש אצלי 😅 נסו שוב בעוד כמה דקות"
PICKER_PROMPT_CHAT = "יש לך כמה אירועים פעילים 🙂 על איזה מהם נדבר?"


def configure_logging():
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(
        fmt='level=%(levelname)s ts=%(asctime)s logger=%(name)s msg="%(message)s"',
        datefmt='%Y-%m-%dT%H:%M:%SZ',
    ))
    root.addHandler(handler)


logger = logging.getLogger("worker")


def log_json(level: int, message: str, **fields):
    if fields:
        message = f"{message} | data={json.dumps(fields, default=str, ensure_ascii=False)}"
    logger.log(level, message)


def send_text(channel, phone: str, text: str):
    mq.publish(channel, OUTPOST_QUEUE, {
        "platform": "WA",
        "recipient": phone,
        "message_type": "free_text",
        "text": text,
        "sender": "assistant",
        "source": "assistant_worker",
    })


def send_event_picker(channel, phone: str, events: List[Dict[str, Any]], prompt: str):
    """Reply buttons for up to 3 events, an interactive list beyond that."""
    if len(events) <= 3:
        interactive = {
            "type": "button",
            "body": {"text": prompt},
            "action": {"buttons": [
                {"type": "reply", "reply": {"id": f"evsel:{e['id']}", "title": (e["name"] or "אירוע")[:20]}}
                for e in events
            ]},
        }
    else:
        interactive = {
            "type": "list",
            "body": {"text": prompt},
            "action": {
                "button": "בחירת אירוע",
                "sections": [{
                    "title": "האירועים שלך",
                    "rows": [
                        {"id": f"evsel:{e['id']}", "title": (e["name"] or "אירוע")[:24]}
                        for e in events[:10]
                    ],
                }],
            },
        }
    mq.publish(channel, OUTPOST_QUEUE, {
        "platform": "WA",
        "recipient": phone,
        "message_type": "interactive",
        "interactive": interactive,
        "sender": "assistant",
        "source": "assistant_worker",
    })


def call_assistant(user: Dict[str, Any], phone: str, event_id: str, text: str,
                   history: List[Dict[str, str]]) -> str:
    now = int(time.time())
    token = pyjwt.encode(
        {"user_id": user["user_id"], "sub": db.canonical_phone(phone), "iat": now, "exp": now + 300},
        JWT_SECRET,
        algorithm="HS256",
    )
    try:
        resp = httpx.post(
            f"{CORE_SERVICE_URL.rstrip('/')}/assistant",
            json={"message": text, "event_id": event_id, "history": history},
            headers={"Authorization": f"Bearer {token}"},
            timeout=ASSISTANT_HTTP_TIMEOUT,
        )
    except httpx.HTTPError as exc:
        log_json(logging.ERROR, "Assistant HTTP call failed", error=str(exc), event_id=event_id)
        return MSG_ERROR
    if resp.status_code == 200:
        return (resp.json().get("reply") or "").strip() or MSG_ERROR
    if resp.status_code in (502, 503):
        return MSG_BUSY
    log_json(logging.ERROR, "Assistant returned error", status=resp.status_code, body=resp.text[:500])
    return MSG_ERROR


def answer_with_assistant(channel, r, phone: str, user: Dict[str, Any],
                          event: Dict[str, Any], text: str):
    hist_key = f"assist:hist:{phone}:{event['id']}"
    history = []
    for raw in r.lrange(hist_key, -MAX_HISTORY_MESSAGES, -1):
        try:
            item = json.loads(raw)
            if isinstance(item, dict) and item.get("role") in ("user", "assistant") and item.get("content"):
                history.append({"role": item["role"], "content": item["content"]})
        except json.JSONDecodeError:
            continue

    reply = call_assistant(user, phone, event["id"], text, history)
    send_text(channel, phone, reply)

    pipe = r.pipeline()
    pipe.rpush(hist_key, json.dumps({"role": "user", "content": text}, ensure_ascii=False))
    pipe.rpush(hist_key, json.dumps({"role": "assistant", "content": reply}, ensure_ascii=False))
    pipe.ltrim(hist_key, -2 * MAX_HISTORY_MESSAGES, -1)
    pipe.expire(hist_key, HISTORY_TTL_SECONDS)
    pipe.execute()
    log_json(logging.INFO, "Assistant replied", phone=phone, event_id=event["id"], reply_len=len(reply))


def handle_event_selection(channel, r, phone: str, user: Dict[str, Any],
                           events: List[Dict[str, Any]], selection_id: str):
    event_id = selection_id.split(":", 1)[1]
    event = next((e for e in events if e["id"] == event_id), None)
    if not event:
        send_text(channel, phone, MSG_EVENT_GONE)
        return

    # A pending contact import takes priority - hand the chosen event back to
    # contact-import-worker, which imports and sends the success message.
    if r.exists(f"ci:pending:{phone}"):
        mq.publish(channel, CONTACT_IMPORT_QUEUE, {
            "type": "finalize_import",
            "sender_phone": phone,
            "event_id": event["id"],
        })
        log_json(logging.INFO, "Forwarded import finalization", phone=phone, event_id=event["id"])
        return

    r.set(f"assist:ctx:{phone}", event["id"], ex=EVENT_CTX_TTL_SECONDS)
    pending_q = r.get(f"assist:pending_q:{phone}")
    if pending_q:
        r.delete(f"assist:pending_q:{phone}")
        answer_with_assistant(channel, r, phone, user, event, pending_q)
    else:
        send_text(channel, phone, f'מעולה, מדברים על "{event["name"]}" 🙂 איך אפשר לעזור?')


def handle_message(conn, channel, r, msg: Dict[str, Any]):
    payload = msg.get("payload") or {}
    phone = msg.get("recipient") or payload.get("from")
    if not phone:
        log_json(logging.WARNING, "Message without sender phone, skipping")
        return

    ts = payload.get("timestamp")
    try:
        if ts and time.time() - int(ts) > MAX_MESSAGE_AGE_SECONDS:
            log_json(logging.INFO, "Skipping stale message", phone=phone, timestamp=ts)
            return
    except (TypeError, ValueError):
        pass

    user = db.get_user_by_phone(conn, phone)
    if not user:
        log_json(logging.INFO, "Sender not registered", phone=phone)
        send_text(channel, phone, MSG_NOT_REGISTERED)
        return

    events = db.get_active_events_owned(conn, user["user_id"])
    if not events:
        log_json(logging.INFO, "Sender owns no active event", phone=phone, user_id=user["user_id"])
        send_text(channel, phone, MSG_NO_ACTIVE_EVENT)
        return

    # Button/list replies from the event picker (category is unreliable for
    # list replies, so inspect the raw interactive payload).
    interactive = payload.get("interactive") or {}
    reply_obj = interactive.get("button_reply") or interactive.get("list_reply") or {}
    selection_id = reply_obj.get("id") or ""
    if selection_id.startswith("evsel:"):
        handle_event_selection(channel, r, phone, user, events, selection_id)
        return
    if msg.get("type") == "quick_reply" or interactive:
        # Some other button tapped (e.g. an old template) - nothing to do.
        log_json(logging.INFO, "Ignoring non-picker interactive reply", phone=phone)
        return

    text = ((payload.get("extracted_data") or {}).get("text")
            or (payload.get("text") or {}).get("body"))
    if not text or not str(text).strip():
        send_text(channel, phone, MSG_TEXT_ONLY)
        return
    text = str(text).strip()

    if len(events) == 1:
        event = events[0]
    else:
        ctx = r.get(f"assist:ctx:{phone}")
        event = next((e for e in events if e["id"] == ctx), None)
        if not event:
            r.set(f"assist:pending_q:{phone}", text, ex=PENDING_QUESTION_TTL_SECONDS)
            send_event_picker(channel, phone, events, PICKER_PROMPT_CHAT)
            return

    answer_with_assistant(channel, r, phone, user, event, text)


def main():
    configure_logging()
    if not JWT_SECRET:
        raise RuntimeError("JWT_SECRET is required")

    conn = db.connect()
    r = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    rabbit = mq.connect()
    channel = rabbit.channel()
    channel.queue_declare(queue=ASSISTANT_INBOUND_QUEUE, durable=True)
    channel.basic_qos(prefetch_count=1)

    def callback(ch, method, properties, body):
        try:
            msg = json.loads(body)
            handle_message(conn, ch, r, msg)
            ch.basic_ack(delivery_tag=method.delivery_tag)
        except json.JSONDecodeError as e:
            log_json(logging.ERROR, "Invalid message JSON", error=str(e))
            ch.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as e:
            log_json(logging.ERROR, "Failed handling assistant message", error=str(e))
            logger.exception("handler error")
            # Ack anyway: a poison message must not wedge the owner's chat.
            ch.basic_ack(delivery_tag=method.delivery_tag)

    channel.basic_consume(queue=ASSISTANT_INBOUND_QUEUE, on_message_callback=callback)
    log_json(logging.INFO, "Assistant worker started", queue=ASSISTANT_INBOUND_QUEUE,
             core_service=CORE_SERVICE_URL)
    channel.start_consuming()


if __name__ == "__main__":
    main()
