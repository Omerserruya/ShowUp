"""
Contact Import Worker

Consumes messages from contact_import_queue and processes WhatsApp contact
imports. Creates import records in the database without creating guests
immediately (the owner approves them in the app's review screen).

Flow:
- Inbound contact messages are buffered per sender for a short window
  (BATCH_WINDOW_SECONDS, default 2s) so that sharing several contacts at
  once - which WhatsApp delivers as separate webhook messages - lands as ONE
  import batch with ONE confirmation message.
- Sender must own at least one ACTIVE event:
    0 events -> polite "no active event" message.
    1 event  -> import immediately + success message.
    2+ events -> contacts are parked in Redis (ci:pending:{phone}) and an
                 interactive event picker is sent. assistant-worker receives
                 the button tap on the assistant number and sends back a
                 {"type": "finalize_import"} message to this queue, which
                 finishes the import for the chosen event.
- All owner-facing messages go out from the ASSISTANT number via Outpost.
"""

import json
import logging
import os
import threading
import time
from typing import Any, Dict, List, Optional

from db import (
    connect as db_connect,
    ensure_schema,
    find_active_events_by_owner_phone,
    check_import_exists,
    create_guest_import,
    create_guest_import_contact,
    normalize_phone,
)
from mq import connect as mq_connect, publish_outpost

import redis


def configure_logging():
    """Configure structured logging."""
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    handler = logging.StreamHandler()
    formatter = logging.Formatter(
        fmt='level=%(levelname)s ts=%(asctime)s logger=%(name)s msg="%(message)s"',
        datefmt='%Y-%m-%dT%H:%M:%SZ'
    )
    handler.setFormatter(formatter)
    root.addHandler(handler)


def log_json(logger: logging.Logger, level: int, message: str, **fields):
    """Log message with JSON-formatted fields."""
    if fields:
        message = f"{message} | data={json.dumps(fields, default=str, ensure_ascii=False)}"
    logger.log(level, message)


OUTPOST_QUEUE = os.getenv("OUTPOST_QUEUE_NAME", "outpost_queue")
CONTACT_IMPORT_QUEUE = os.getenv("CONTACT_IMPORT_QUEUE", "contact_import_queue")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
# Debounce window: extra contact messages from the same sender within this
# window join the same batch (WhatsApp sends multi-contact shares as several
# webhook messages).
BATCH_WINDOW_SECONDS = float(os.getenv("CONTACT_BATCH_WINDOW_SECONDS", "2"))
PENDING_SELECTION_TTL_SECONDS = int(os.getenv("PENDING_SELECTION_TTL_SECONDS", "3600"))

BUF_KEY = "ci:buf:{phone}"
DUE_KEY = "ci:due:{phone}"
PENDING_KEY = "ci:pending:{phone}"

# Hebrew owner-facing messages
NO_ACTIVE_EVENT_MESSAGE = "נראה שאין לך אירוע פעיל כרגע, אז אין לנו מה לעשות עם אנשי הקשר ששלחת 😅"
NO_PENDING_MESSAGE = "לא מצאתי אנשי קשר שממתינים להעלאה. אפשר לשלוח אותם שוב 🙂"
PICKER_PROMPT = "יש לך כמה אירועים פעילים 🙂 לאיזה אירוע להעלות את {count} אנשי הקשר?"


def success_message(count: int, event_name: str) -> str:
    return f"הועלו בהצלחה {count} אורחים לאירוע {event_name}, אנא אשר אותם במערכת ✅"


def extract_contacts_from_message(raw_message: Dict[str, Any]) -> list:
    """Extract contacts array from WhatsApp message payload."""
    contacts = raw_message.get("contacts", [])
    if not isinstance(contacts, list):
        return []
    return contacts


def extract_contact_data(contact: Dict[str, Any]) -> Dict[str, Optional[str]]:
    """Extract name, phone, and email from a contact object."""
    name_obj = contact.get("name", {})
    name = name_obj.get("formatted_name") if isinstance(name_obj, dict) else None

    phones = contact.get("phones", [])
    phone = None
    if isinstance(phones, list) and len(phones) > 0:
        phone_obj = phones[0]
        if isinstance(phone_obj, dict):
            phone = phone_obj.get("phone")

    emails = contact.get("emails", [])
    email = None
    if isinstance(emails, list) and len(emails) > 0:
        email_obj = emails[0]
        if isinstance(email_obj, dict):
            email = email_obj.get("email")

    return {"name": name, "phone": phone, "email": email}


def send_owner_text(channel, phone: str, text: str):
    """Send an owner-facing text from the assistant number via Outpost."""
    message = {
        "platform": "WA",
        "recipient": phone,
        "message_type": "free_text",
        "text": text,
        "sender": "assistant",
        "source": "contact_import_worker",
    }
    publish_outpost(channel, OUTPOST_QUEUE, message)


def send_event_picker(channel, phone: str, events: List[Dict[str, Any]], contact_count: int):
    """Reply buttons for up to 3 events, an interactive list beyond that.

    Button ids use the shared evsel:{event_id} namespace handled by
    assistant-worker (the tap arrives on the assistant number).
    """
    prompt = PICKER_PROMPT.format(count=contact_count)
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
    publish_outpost(channel, OUTPOST_QUEUE, {
        "platform": "WA",
        "recipient": phone,
        "message_type": "interactive",
        "interactive": interactive,
        "sender": "assistant",
        "source": "contact_import_worker",
    })


def import_batch(conn, event_id: str, buffered: List[Dict[str, Any]]) -> int:
    """Create import + contact records for a batch of buffered WA messages.

    One guest_imports row per original WhatsApp message (message_id keeps its
    unique/idempotency semantics). Returns the number of contacts created.
    """
    logger = logging.getLogger("worker")
    created_count = 0

    for msg in buffered:
        message_id = msg.get("message_id")
        raw_message = msg.get("raw_message") or {}

        if message_id and check_import_exists(conn, message_id):
            log_json(logger, logging.INFO, "Import already processed (idempotency)",
                     message_id=message_id)
            continue

        contacts = extract_contacts_from_message(raw_message)
        if not contacts:
            continue

        import_id = create_guest_import(
            conn=conn,
            event_id=event_id,
            raw_payload=json.dumps(raw_message, ensure_ascii=False),
            message_id=message_id,
            source="whatsapp",
        )

        for contact in contacts:
            try:
                contact_data = extract_contact_data(contact)
                create_guest_import_contact(
                    conn=conn,
                    import_id=import_id,
                    name=contact_data["name"],
                    phone=contact_data["phone"],
                    email=contact_data["email"],
                )
                created_count += 1
            except Exception as e:
                log_json(logger, logging.ERROR, "Failed to create import contact",
                         import_id=import_id, contact=contact, error=str(e))

        log_json(logger, logging.INFO, "Created guest import record",
                 import_id=import_id, event_id=event_id, message_id=message_id,
                 contact_count=len(contacts))

    return created_count


def process_batch(conn, channel, r, phone: str, buffered: List[Dict[str, Any]]):
    """A sender's debounce window closed - import or ask which event."""
    logger = logging.getLogger("worker")

    total_contacts = sum(len(extract_contacts_from_message(m.get("raw_message") or {}))
                         for m in buffered)
    if total_contacts == 0:
        log_json(logger, logging.WARNING, "Batch with no contacts", phone=phone)
        return

    normalized_phone = normalize_phone(phone)
    if not normalized_phone:
        log_json(logger, logging.ERROR, "Invalid sender phone", phone=phone)
        return

    events = find_active_events_by_owner_phone(conn, normalized_phone)

    if not events:
        log_json(logger, logging.INFO, "No active event found for owner", phone=normalized_phone)
        send_owner_text(channel, phone, NO_ACTIVE_EVENT_MESSAGE)
        return

    if len(events) == 1:
        event = events[0]
        created = import_batch(conn, str(event["id"]), buffered)
        if created:
            send_owner_text(channel, phone, success_message(created, event["name"]))
        log_json(logger, logging.INFO, "Contact batch imported",
                 phone=phone, event_id=str(event["id"]), created=created)
        return

    # Several active events: park the batch and let the owner pick.
    r.set(PENDING_KEY.format(phone=phone),
          json.dumps(buffered, ensure_ascii=False),
          ex=PENDING_SELECTION_TTL_SECONDS)
    send_event_picker(channel, phone, events, total_contacts)
    log_json(logger, logging.INFO, "Waiting for event selection",
             phone=phone, events=len(events), contacts=total_contacts)


def handle_finalize(conn, channel, r, message: Dict[str, Any]):
    """assistant-worker relayed the owner's event choice - finish the import."""
    logger = logging.getLogger("worker")
    phone = message.get("sender_phone")
    event_id = message.get("event_id")
    if not phone or not event_id:
        log_json(logger, logging.ERROR, "finalize_import missing fields", message=message)
        return

    raw = r.get(PENDING_KEY.format(phone=phone))
    if not raw:
        send_owner_text(channel, phone, NO_PENDING_MESSAGE)
        return

    # Re-validate: the chosen event must still be active and owned by sender.
    events = find_active_events_by_owner_phone(conn, normalize_phone(phone) or phone)
    event = next((e for e in events if str(e["id"]) == str(event_id)), None)
    if not event:
        r.delete(PENDING_KEY.format(phone=phone))
        send_owner_text(channel, phone, NO_ACTIVE_EVENT_MESSAGE)
        return

    buffered = json.loads(raw)
    created = import_batch(conn, str(event["id"]), buffered)
    r.delete(PENDING_KEY.format(phone=phone))
    if created:
        send_owner_text(channel, phone, success_message(created, event["name"]))
    log_json(logger, logging.INFO, "Finalized contact import",
             phone=phone, event_id=str(event["id"]), created=created)


def buffer_contact_message(r, message: Dict[str, Any]):
    """Debounce: append to the sender's buffer and (re)arm the flush timer."""
    phone = message.get("sender_phone")
    pipe = r.pipeline()
    pipe.rpush(BUF_KEY.format(phone=phone), json.dumps(message, ensure_ascii=False))
    pipe.expire(BUF_KEY.format(phone=phone), 3600)
    pipe.set(DUE_KEY.format(phone=phone), str(time.time() + BATCH_WINDOW_SECONDS), ex=3600)
    pipe.execute()


def flusher_loop(r):
    """Background thread: flush sender buffers whose debounce window closed.

    Uses its OWN db and rabbit connections - pika BlockingConnection is not
    thread-safe and must not be shared with the consumer thread.
    """
    logger = logging.getLogger("flusher")
    conn = db_connect()
    rabbit = mq_connect()
    channel = rabbit.channel()

    def reconnect_mq():
        nonlocal rabbit, channel
        try:
            rabbit.close()
        except Exception:
            pass
        rabbit = mq_connect()
        channel = rabbit.channel()

    while True:
        try:
            for key in r.scan_iter("ci:due:*"):
                due_raw = r.get(key)
                if due_raw is None or time.time() < float(due_raw):
                    continue
                phone = key.split(":", 2)[2]
                # DELETE is the atomic claim - only one flusher wins.
                if not r.delete(key):
                    continue
                buf_key = BUF_KEY.format(phone=phone)
                pipe = r.pipeline()
                pipe.lrange(buf_key, 0, -1)
                pipe.delete(buf_key)
                items, _ = pipe.execute()
                buffered = []
                for item in items:
                    try:
                        buffered.append(json.loads(item))
                    except json.JSONDecodeError:
                        continue
                if not buffered:
                    continue
                if conn.closed:
                    conn = db_connect()
                if rabbit.is_closed or channel.is_closed:
                    reconnect_mq()
                try:
                    process_batch(conn, channel, r, phone, buffered)
                except Exception as e:
                    # A dead AMQP connection surfaces here on first publish.
                    # Reconnect and retry once so the batch isn't dropped
                    # (import_batch is idempotent per message_id, so a retry
                    # can't double-import).
                    log_json(logger, logging.WARNING, "Batch failed, retrying once",
                             phone=phone, error=str(e))
                    reconnect_mq()
                    if conn.closed:
                        conn = db_connect()
                    process_batch(conn, channel, r, phone, buffered)
        except Exception as e:
            log_json(logger, logging.ERROR, "Flusher iteration failed", error=str(e))
            logger.exception("flusher error")
            try:
                if rabbit.is_closed:
                    reconnect_mq()
            except Exception:
                pass
            try:
                if conn.closed:
                    conn = db_connect()
            except Exception:
                pass
        # Sleep via pika so AMQP heartbeats keep being serviced while idle -
        # plain time.sleep starves them and the broker kills the connection.
        try:
            rabbit.sleep(0.5)
        except Exception:
            time.sleep(0.5)


def main():
    """Main worker entry point."""
    configure_logging()
    logger = logging.getLogger("worker")

    conn = db_connect()

    try:
        ensure_schema(conn)
        log_json(logger, logging.INFO, "Database schema ensured")
    except Exception as e:
        log_json(logger, logging.ERROR, "Failed ensuring schema - exiting", error=str(e), exc_info=True)
        conn.close()
        raise

    r = redis.Redis.from_url(REDIS_URL, decode_responses=True)

    rabbit = mq_connect()
    channel = rabbit.channel()
    channel.queue_declare(queue=CONTACT_IMPORT_QUEUE, durable=True)

    flusher = threading.Thread(target=flusher_loop, args=(r,), daemon=True, name="flusher")
    flusher.start()

    def callback(ch, method, properties, body):
        """Callback for processing messages from queue."""
        try:
            message = json.loads(body)

            if message.get("type") == "finalize_import":
                handle_finalize(conn, ch, r, message)
            elif not message.get("sender_phone"):
                log_json(logger, logging.ERROR, "Missing sender_phone in message",
                         message_id=message.get("message_id"))
            else:
                buffer_contact_message(r, message)

            ch.basic_ack(delivery_tag=method.delivery_tag)

        except json.JSONDecodeError as e:
            log_json(logger, logging.ERROR, "Invalid message JSON", error=str(e))
            ch.basic_ack(delivery_tag=method.delivery_tag)  # Ack to avoid infinite loop
        except Exception as e:
            log_json(logger, logging.ERROR, "Contact import processing failed", error=str(e), exc_info=True)
            ch.basic_ack(delivery_tag=method.delivery_tag)

    channel.basic_consume(queue=CONTACT_IMPORT_QUEUE, on_message_callback=callback)
    log_json(logger, logging.INFO, "Contact import worker started",
             queue=CONTACT_IMPORT_QUEUE, batch_window_seconds=BATCH_WINDOW_SECONDS)
    channel.start_consuming()


if __name__ == "__main__":
    main()
