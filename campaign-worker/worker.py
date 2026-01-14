import os
import json
import logging
import threading
from typing import Dict, Any

from tenacity import retry, stop_after_attempt, wait_exponential

from db import (
    connect as db_connect,
    fetch_campaign_by_id,
    fetch_event_by_id,
    was_message_sent,
    mark_message_sent,
    mark_campaign_completed,
)
from mq import connect as mq_connect, publish_outpost
from template_registry import get_template_spec


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


def process_campaign(conn, channel, campaign_id: str):
    logger = logging.getLogger("worker")

    # Fetch campaign data from database
    campaign_data = fetch_campaign_by_id(conn, campaign_id)
    if not campaign_data:
        log_json(logger, logging.ERROR, "Campaign not found", campaign_id=campaign_id)
        return

    event_id = str(campaign_data["event_id"])
    template_name = campaign_data["template"]

    # Fetch event data
    event_data = fetch_event_by_id(conn, event_id)
    if not event_data:
        log_json(logger, logging.ERROR, "Event not found", campaign_id=campaign_id, event_id=event_id)
        return
    
    # Check if event is active - don't send campaigns for inactive events
    if not event_data.get("active", True):
        log_json(logger, logging.INFO, "Event is inactive, skipping campaign", 
                 campaign_id=campaign_id, event_id=event_id)
        return
    
    # Log event data including inviters for debugging
    log_json(logger, logging.INFO, "Fetched event data", 
             event_id=event_id, 
             inviters=event_data.get("inviters"),
             inviters_type=type(event_data.get("inviters")).__name__ if event_data.get("inviters") else "None")

    # Get template handler
    template_spec = get_template_spec(template_name)

    # Get guest list from template spec
    try:
        guests = template_spec.audience_selector(conn, event_id, event_data)
        log_json(
            logger,
            logging.INFO,
            "Template handler selected guests",
            campaign_id=campaign_id,
            template=template_name,
            guest_count=len(guests),
        )
    except Exception as e:
        log_json(logger, logging.ERROR, "Template handler failed", campaign_id=campaign_id, template=template_name, error=str(e))
        return

    sent_count = 0
    failed_count = 0
    
    for guest in guests:
        guest_id = str(guest["id"]) if isinstance(guest["id"], (str,)) else str(guest["id"])
        
        # Check idempotency
        if was_message_sent(conn, campaign_id, guest_id):
            continue

        # Build parameters using template-specific logic
        try:
            params = template_spec.params_builder(event_data, guest)
        except Exception as e:
            failed_count += 1
            log_json(logger, logging.ERROR, "Parameter building failed", campaign_id=campaign_id, guest_id=guest_id, error=str(e))
            continue

        # Build outpost message payload
        # outpost-service will create Conversation when sending the message
        message = {
            "platform": "WA",
            "recipient": str(guest.get("phone")),
            "template": template_spec.wa_template,
            "parameters": params,
            "message_type": "template",  # Campaign messages are template-based
            "source": "campaign_worker",
            "event_id": event_id,  # Real event UUID, not wamid
            # Use template name as a logical state marker for logging/traceability
            "state": template_name,
            "campaign_id": campaign_id,
            "guest_id": guest_id
        }

        try:
            publish_outpost(channel, OUTPOST_QUEUE, message)
            mark_message_sent(conn, campaign_id, guest_id)
            sent_count += 1
        except Exception as e:
            failed_count += 1
            log_json(logger, logging.ERROR, "Failed to enqueue message", campaign_id=campaign_id, guest_id=guest_id, error=str(e))

    # After processing all guests, mark campaign as completed ('sent') and store recipient_count
    try:
        mark_campaign_completed(conn, campaign_id, sent_count)
    except Exception as e:
        log_json(
            logger,
            logging.ERROR,
            "Failed to update campaign status to sent",
            campaign_id=campaign_id,
            error=str(e),
        )

    log_json(
        logger,
        logging.INFO,
        "Campaign processed",
        campaign_id=campaign_id,
        template=template_name,
        sent=sent_count,
        failed=failed_count,
    )


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
            message = json.loads(body)
            campaign_id = message.get("campaign_id")
            if not campaign_id:
                log_json(logger, logging.ERROR, "Missing campaign_id in message")
                ch.basic_ack(delivery_tag=method.delivery_tag)
                return
        except Exception as e:
            log_json(logger, logging.ERROR, "Invalid message JSON", error=str(e))
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

        try:
            process_campaign(conn, channel, campaign_id)
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


