"""
Contact Import Worker

Consumes messages from contact_import_queue and processes WhatsApp contact imports.
Creates import records in the database without creating guests immediately.
"""

import os
import json
import logging
from typing import Dict, Any, Optional

from tenacity import retry, stop_after_attempt, wait_exponential

from db import (
    connect as db_connect,
    ensure_schema,
    find_active_event_by_owner_phone,
    check_import_exists,
    create_guest_import,
    create_guest_import_contact,
    normalize_phone,
)
from mq import connect as mq_connect, publish_outpost


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

# Hebrew message for when no active event is found
NO_ACTIVE_EVENT_MESSAGE = "נראה שאין לך אירוע פעיל כרגע, אז אין לנו מה לעשות עם אנשי הקשר ששלחת 😅"


def extract_contacts_from_message(raw_message: Dict[str, Any]) -> list:
    """
    Extract contacts array from WhatsApp message payload.
    
    Args:
        raw_message: Full WhatsApp message payload
        
    Returns:
        List of contact dictionaries
    """
    contacts = raw_message.get("contacts", [])
    if not isinstance(contacts, list):
        return []
    return contacts


def extract_contact_data(contact: Dict[str, Any]) -> Dict[str, Optional[str]]:
    """
    Extract name, phone, and email from a contact object.
    
    Args:
        contact: Contact object from WhatsApp API
        
    Returns:
        Dict with name, phone, email (may be None)
    """
    # Extract name (formatted_name from name object)
    name_obj = contact.get("name", {})
    name = name_obj.get("formatted_name") if isinstance(name_obj, dict) else None
    
    # Extract primary phone (first phone number)
    phones = contact.get("phones", [])
    phone = None
    if isinstance(phones, list) and len(phones) > 0:
        phone_obj = phones[0]
        if isinstance(phone_obj, dict):
            phone = phone_obj.get("phone")
    
    # Extract primary email (first email)
    emails = contact.get("emails", [])
    email = None
    if isinstance(emails, list) and len(emails) > 0:
        email_obj = emails[0]
        if isinstance(email_obj, dict):
            email = email_obj.get("email")
    
    return {
        "name": name,
        "phone": phone,
        "email": email
    }


def send_no_active_event_message(channel, sender_phone: str):
    """
    Send a message via Outpost when no active event is found.
    
    Args:
        channel: RabbitMQ channel
        sender_phone: Phone number to send message to
    """
    message = {
        "platform": "WA",
        "recipient": sender_phone,
        "message_type": "free_text",
        "text": NO_ACTIVE_EVENT_MESSAGE,
        "source": "contact_import_worker",
    }
    
    try:
        publish_outpost(channel, OUTPOST_QUEUE, message)
        log_json(
            logging.getLogger("worker"),
            logging.INFO,
            "Sent no active event message",
            sender_phone=sender_phone
        )
    except Exception as e:
        log_json(
            logging.getLogger("worker"),
            logging.ERROR,
            "Failed to send no active event message",
            sender_phone=sender_phone,
            error=str(e)
        )


def process_contact_import(conn, channel, message: Dict[str, Any]):
    """
    Process a contact import message.
    
    Args:
        conn: Database connection
        channel: RabbitMQ channel
        message: Message from contact_import_queue
    """
    logger = logging.getLogger("worker")
    
    try:
        message_id = message.get("message_id")
        sender_phone = message.get("sender_phone")
        raw_message = message.get("raw_message", {})
        
        if not sender_phone:
            log_json(logger, logging.ERROR, "Missing sender_phone in message", message_id=message_id)
            return
        
        if not raw_message:
            log_json(logger, logging.ERROR, "Missing raw_message in payload", message_id=message_id)
            return
        
        # Idempotency check
        if message_id and check_import_exists(conn, message_id):
            log_json(
                logger,
                logging.INFO,
                "Import already processed (idempotency)",
                message_id=message_id,
                sender_phone=sender_phone
            )
            return
        
        # Normalize sender phone
        normalized_sender_phone = normalize_phone(sender_phone)
        if not normalized_sender_phone:
            log_json(logger, logging.ERROR, "Invalid sender phone", sender_phone=sender_phone)
            return
        
        # Find active event for this owner
        event = find_active_event_by_owner_phone(conn, normalized_sender_phone)
        
        if not event:
            # No active event found - send message via Outpost
            log_json(
                logger,
                logging.INFO,
                "No active event found for owner",
                sender_phone=normalized_sender_phone
            )
            send_no_active_event_message(channel, sender_phone)
            return
        
        event_id = str(event["id"])
        
        # Extract contacts from message
        contacts = extract_contacts_from_message(raw_message)
        
        if not contacts:
            log_json(
                logger,
                logging.WARNING,
                "No contacts found in message",
                message_id=message_id,
                event_id=event_id
            )
            return
        
        # Create import record
        raw_payload_json = json.dumps(raw_message, ensure_ascii=False)
        import_id = create_guest_import(
            conn=conn,
            event_id=event_id,
            raw_payload=raw_payload_json,
            message_id=message_id,
            source="whatsapp"
        )
        
        log_json(
            logger,
            logging.INFO,
            "Created guest import record",
            import_id=import_id,
            event_id=event_id,
            message_id=message_id,
            contact_count=len(contacts)
        )
        
        # Create contact records (with partial failure handling)
        created_count = 0
        failed_count = 0
        
        for contact in contacts:
            try:
                contact_data = extract_contact_data(contact)
                
                create_guest_import_contact(
                    conn=conn,
                    import_id=import_id,
                    name=contact_data["name"],
                    phone=contact_data["phone"],
                    email=contact_data["email"]
                )
                created_count += 1
                
            except Exception as e:
                failed_count += 1
                log_json(
                    logger,
                    logging.ERROR,
                    "Failed to create import contact",
                    import_id=import_id,
                    contact=contact,
                    error=str(e)
                )
        
        log_json(
            logger,
            logging.INFO,
            "Contact import processing completed",
            import_id=import_id,
            event_id=event_id,
            created=created_count,
            failed=failed_count
        )
        
    except Exception as e:
        log_json(
            logger,
            logging.ERROR,
            "Failed to process contact import",
            message_data=message,
            error=str(e),
            exc_info=True
        )
        raise


def main():
    """Main worker entry point."""
    configure_logging()
    logger = logging.getLogger("worker")
    
    # Connect to database
    conn = db_connect()
    
    # Ensure schema exists - critical, so exit if it fails
    try:
        ensure_schema(conn)
        log_json(logger, logging.INFO, "Database schema ensured")
    except Exception as e:
        log_json(logger, logging.ERROR, "Failed ensuring schema - exiting", error=str(e), exc_info=True)
        conn.close()
        raise
    
    # Connect to RabbitMQ
    rabbit = mq_connect()
    channel = rabbit.channel()
    
    # Declare queue
    channel.queue_declare(queue=CONTACT_IMPORT_QUEUE, durable=True)
    
    def callback(ch, method, properties, body):
        """Callback for processing messages from queue."""
        try:
            message = json.loads(body)
            
            # Process the contact import
            process_contact_import(conn, channel, message)
            
            # Acknowledge message
            ch.basic_ack(delivery_tag=method.delivery_tag)
            
        except json.JSONDecodeError as e:
            log_json(logger, logging.ERROR, "Invalid message JSON", error=str(e))
            ch.basic_ack(delivery_tag=method.delivery_tag)  # Ack to avoid infinite loop
        except Exception as e:
            log_json(logger, logging.ERROR, "Contact import processing failed", error=str(e), exc_info=True)
            # Nack with requeue for transient errors
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
    
    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue=CONTACT_IMPORT_QUEUE, on_message_callback=callback)
    
    log_json(
        logger,
        logging.INFO,
        "Contact import worker started",
        queue=CONTACT_IMPORT_QUEUE,
        outpost_queue=OUTPOST_QUEUE
    )
    
    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        log_json(logger, logging.INFO, "Contact import worker stopped")
        channel.stop_consuming()
        rabbit.close()
        conn.close()


if __name__ == "__main__":
    main()

