from fastapi import FastAPI, Request, HTTPException, Response
from fastapi.responses import JSONResponse
import uvicorn
import logging
import os
from typing import Dict, Any, List, Optional
import json
import hmac
import hashlib
from datetime import datetime
import pika
from jsonschema import validate, ValidationError

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="WhatsApp Webhook Handler",
    description="WhatsApp webhook handler that validates, categorizes, and enqueues messages",
    version="1.0.0"
)

# Environment variables
VERIFY_TOKEN = os.getenv("WEBHOOK_VERIFY_TOKEN")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET")
RABBITMQ_HOST = os.getenv("RABBITMQ_HOST")
RABBITMQ_PORT = int(os.getenv("RABBITMQ_PORT"))
RABBITMQ_USER = os.getenv("RABBITMQ_USER")
RABBITMQ_PASSWORD = os.getenv("RABBITMQ_PASSWORD")
WEBHOOK_QUEUE = os.getenv("WEBHOOK_QUEUE")
PORT = int(os.getenv("PORT"))

# WhatsApp message schema
WHATSAPP_MESSAGE_SCHEMA = {
    "type": "object",
    "properties": {
        "object": {"type": "string"},
        "entry": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "changes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "value": {
                                    "type": "object",
                                    "properties": {
                                        "messaging_product": {"type": "string"},
                                        "metadata": {
                                            "type": "object",
                                            "properties": {
                                                "display_phone_number": {"type": "string"},
                                                "phone_number_id": {"type": "string"}
                                            }
                                        },
                                        "messages": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "id": {"type": "string"},
                                                    "from": {"type": "string"},
                                                    "timestamp": {"type": "string"},
                                                    "type": {"type": "string", "enum": ["text", "image", "audio", "video", "document", "contacts", "interactive", "button"]},
                                                    "text": {"type": "object"},
                                                    "interactive": {"type": "object"},
                                                    "contacts": {"type": "array"}
                                                },
                                                "required": ["id", "from", "timestamp", "type"]
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    },
    "required": ["object", "entry"]
}

def verify_webhook_signature(payload: bytes, signature: str, secret: str) -> bool:
    """Verify the HMAC signature from Meta"""
    if not secret or not signature:
        return False
    
    try:
        # Remove 'sha256=' prefix if present
        if signature.startswith('sha256='):
            signature = signature[7:]
        
        # Create HMAC hash
        expected_signature = hmac.new(
            secret.encode('utf-8'),
            payload,
            hashlib.sha256
        ).hexdigest()
        
        # Compare signatures securely
        return hmac.compare_digest(signature, expected_signature)
    except Exception as e:
        logger.error(f"Error verifying signature: {e}")
        return False

def validate_whatsapp_message(data: Dict[str, Any]) -> bool:
    """Validate WhatsApp message against schema"""
    try:
        validate(instance=data, schema=WHATSAPP_MESSAGE_SCHEMA)
        return True
    except ValidationError as e:
        logger.error(f"Schema validation failed: {e}")
        return False

def categorize_message(message: Dict[str, Any]) -> str:
    """Categorize message type"""
    msg_type = message.get("type", "")
    
    if msg_type == "interactive":
        interactive = message.get("interactive", {})
        if interactive.get("type") == "button_reply":
            return "quick_reply"
        return "message"
    elif msg_type == "button":
        return "quick_reply"
    elif msg_type == "contacts":
        return "contacts"
    else:
        return "message"

def extract_message_data(message: Dict[str, Any], category: str) -> Dict[str, Any]:
    """Extract relevant data based on message category"""
    if category == "quick_reply":
        # Handle both interactive button_reply and direct button type
        interactive = message.get("interactive", {})
        if interactive.get("type") == "button_reply":
            return {
                "button_id": interactive.get("button_reply", {}).get("id"),
                "button_title": interactive.get("button_reply", {}).get("title")
            }
        else:
            # Handle direct button type
            button = message.get("button", {})
            return {
                "button_id": button.get("id"),
                "button_title": button.get("title"),
                "button_text": button.get("text")
            }
    elif category == "contacts":
        contacts = message.get("contacts", [])
        return {
            "contacts": [
                {
                    "name": contact.get("name", {}).get("formatted_name"),
                    "phones": [phone.get("phone") for phone in contact.get("phones", [])],
                    "emails": [email.get("email") for email in contact.get("emails", [])]
                }
                for contact in contacts
            ]
        }
    else:  # message
        text = message.get("text", {})
        return {
            "text": text.get("body"),
            "media_type": message.get("type") if message.get("type") in ["image", "audio", "video", "document"] else None
        }

def enqueue_to_rabbitmq(topic: str, message_data: Dict[str, Any]) -> bool:
    """Enqueue message to RabbitMQ webhook_queue with topic"""
    try:
        # Build connection URL from individual parameters
        connection_url = f"amqp://{RABBITMQ_USER}:{RABBITMQ_PASSWORD}@{RABBITMQ_HOST}:{RABBITMQ_PORT}/"
        
        connection = pika.BlockingConnection(pika.URLParameters(connection_url))
        channel = connection.channel()
        
        # Declare queue
        channel.queue_declare(queue=WEBHOOK_QUEUE, durable=True)
        
        # Prepare message with topic
        tagged_message = {
            **message_data,
            "topic": topic,
            "enqueued_at": datetime.utcnow().isoformat()
        }
        
        # Publish message
        channel.basic_publish(
            exchange='',
            routing_key=WEBHOOK_QUEUE,
            body=json.dumps(tagged_message),
            properties=pika.BasicProperties(
                delivery_mode=2,  # Make message persistent
                headers={'topic': topic}  # Add topic as header for easy filtering
            )
        )
        
        connection.close()
        logger.info(f"Message enqueued to {WEBHOOK_QUEUE} with topic '{topic}'")
        return True
    except Exception as e:
        logger.error(f"Error enqueueing to RabbitMQ: {e}")
        return False

@app.get("/")
async def verify_webhook(request: Request):
    """Webhook verification endpoint for Meta"""
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")

    if mode == "subscribe" and token == VERIFY_TOKEN:
        logger.info("Webhook verified successfully")
        return Response(content=challenge, media_type="text/plain", status_code=200)
    else:
        logger.warning("Webhook verification failed")
        return "Forbidden", 403

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}

@app.post("/")
async def handle_whatsapp_webhook(request: Request):
    """
    WhatsApp webhook handler that validates, categorizes, and enqueues messages
    """
    try:
        # Get raw body for signature verification
        body = await request.body()
        
        # Verify HMAC signature
        signature = request.headers.get("X-Hub-Signature-256", "")
        if not verify_webhook_signature(body, signature, WEBHOOK_SECRET):
            logger.warning("Invalid webhook signature")
            raise HTTPException(status_code=400, detail="Invalid signature")
        
        # Parse JSON
        try:
            data = json.loads(body.decode('utf-8'))
        except json.JSONDecodeError:
            logger.error("Invalid JSON payload")
            raise HTTPException(status_code=400, detail="Invalid JSON")
        
        # Validate schema
        if not validate_whatsapp_message(data):
            logger.error("Schema validation failed")
            raise HTTPException(status_code=400, detail="Invalid message schema")
        
        # Process messages
        processed_count = 0
        for entry in data.get("entry", []):
            for change in entry.get("changes", []):
                messages = change.get("value", {}).get("messages", [])
                
                for message in messages:
                    message_id = message.get("id")
                    sender = message.get("from")
                    
                    # Categorize message
                    category = categorize_message(message)
                    
                    # Extract relevant data
                    extracted_data = extract_message_data(message, category)
                    
                    # Prepare queue payload
                    queue_payload = {
                        "event_id": message_id,
                        "recipient": sender,
                        "message_id": message_id,
                        "type": category,
                        "payload": {
                            **message,
                            "extracted_data": extracted_data
                        },
                        "received_at": datetime.utcnow().isoformat()
                    }
                    
                    # Handle contacts specially - enqueue each contact individually
                    if category == "contacts":
                        contacts = extracted_data.get("contacts", [])
                        for i, contact in enumerate(contacts):
                            contact_payload = {
                                **queue_payload,
                                "contact_index": i,
                                "payload": {
                                    **message,
                                    "extracted_data": {"contact": contact}
                                }
                            }
                            
                            if enqueue_to_rabbitmq("contacts", contact_payload):
                                processed_count += 1
                                logger.info(f"Enqueued contact {i+1}/{len(contacts)} with topic 'contacts' from message {message_id}")
                    else:
                        # Enqueue single message with topic
                        if enqueue_to_rabbitmq(category, queue_payload):
                            processed_count += 1
                            logger.info(f"Enqueued {category} message {message_id} with topic '{category}'")
        
        return JSONResponse(
            status_code=200,
            content={
                "message": "Messages processed successfully",
                "processed_count": processed_count,
                "timestamp": datetime.utcnow().isoformat()
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing webhook: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=PORT,
        reload=True,
        log_level="info"
    )