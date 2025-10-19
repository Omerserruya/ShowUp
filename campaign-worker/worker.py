import os
import json
import logging
import threading
from typing import Dict, Any

from tenacity import retry, stop_after_attempt, wait_exponential

from db import connect as db_connect, fetch_guests_for_event, was_message_sent, mark_message_sent
from mq import connect as mq_connect, publish_outpost
from templates import TemplateSpec, merge_params, build_whatsapp_template_payload


def configure_logging():
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
    if fields:
        message = f"{message} | data={json.dumps(fields, default=str)}"
    logger.log(level, message)


OUTPOST_QUEUE = os.getenv("OUTPOST_QUEUE_NAME")


def process_campaign(conn, channel, campaign: Dict[str, Any]):
    logger = logging.getLogger("worker")

    campaign_id = campaign.get("campaign_id")
    event_id = campaign.get("event_id")
    payload = campaign.get("payload", {})
    template_name = payload.get("template_name") or payload.get("template")
    template_params = payload.get("params", {})

    # Define template spec - could be fetched from DB/config later
    spec = TemplateSpec(
        name=template_name,
        required_params=["name"],
        defaults={}
    )

    guests = fetch_guests_for_event(conn, event_id)
    sent_count = 0
    failed_count = 0
    for guest in guests:
        guest_id = str(guest["id"]) if isinstance(guest["id"], (str,)) else str(guest["id"])
        if was_message_sent(conn, campaign_id, guest_id):
            continue

        # Construct parameters per guest
        params = {**template_params, "name": guest.get("name")}
        try:
            merged = merge_params(spec, params)
        except Exception as e:
            failed_count += 1
            log_json(logger, logging.ERROR, "Template validation failed", campaign_id=campaign_id, guest_id=guest_id, error=str(e))
            continue

        # Build outpost message payload (WhatsApp Cloud API)
        message = {
            "platform": "WA",
            "recipient": str(guest.get("phone")),
            "content": build_whatsapp_template_payload(template_name, merged),
            "metadata": {
                "campaign_id": campaign_id,
                "event_id": event_id,
                "guest_id": guest_id,
            },
        }

        try:
            publish_outpost(channel, OUTPOST_QUEUE, message)
            mark_message_sent(conn, campaign_id, guest_id)
            sent_count += 1
        except Exception as e:
            failed_count += 1
            log_json(logger, logging.ERROR, "Failed to enqueue message", campaign_id=campaign_id, guest_id=guest_id, error=str(e))

    log_json(logger, logging.INFO, "Campaign processed", campaign_id=campaign_id, sent=sent_count, failed=failed_count)


def main():
    configure_logging()
    logger = logging.getLogger("worker")

    conn = db_connect()
    # Ensure idempotency table exists
    try:
        from db import ensure_schema
        ensure_schema(conn)
    except Exception as e:
        log_json(logger, logging.ERROR, "Failed ensuring schema", error=str(e))
    rabbit = mq_connect()
    channel = rabbit.channel()

    queue_name = os.getenv("CAMPAIGNS_QUEUE")
    channel.queue_declare(queue=queue_name, durable=True)

    def callback(ch, method, properties, body):
        try:
            campaign = json.loads(body)
        except Exception as e:
            log_json(logger, logging.ERROR, "Invalid campaign JSON", error=str(e))
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

        try:
            process_campaign(conn, channel, campaign)
            ch.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as e:
            log_json(logger, logging.ERROR, "Campaign processing failed", error=str(e))
            # Nack with requeue for transient errors
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue=queue_name, on_message_callback=callback)

    log_json(logger, logging.INFO, "Campaign worker started", queue=queue_name, outpost_queue=OUTPOST_QUEUE)
    channel.start_consuming()


if __name__ == "__main__":
    main()


