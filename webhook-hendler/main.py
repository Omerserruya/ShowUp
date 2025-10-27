from fastapi import FastAPI, Request, HTTPException, Depends, Response
from fastapi.responses import JSONResponse
import uvicorn
import logging
import os
from typing import Dict, Any
import json
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Webhook Handler",
    description="A FastAPI webhook handler service",
    version="1.0.0"
)

VERIFY_TOKEN = os.getenv("WEBHOOK_VERIFY_TOKEN")

# In-memory storage for webhook events (replace with database in production)
webhook_events = []

@app.get("/")
async def verify_webhook(request: Request):
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
async def handle_webhook(request: Request):
    """
    Generic webhook endpoint that accepts any POST request
    """
    try:
        # Get the raw body
        body = await request.body()
        
        # Get headers
        headers = dict(request.headers)
        
        # Parse JSON if possible
        try:
            json_data = json.loads(body.decode('utf-8'))
        except json.JSONDecodeError:
            json_data = None
        
        # Create webhook event record
        webhook_event = {
            "id": len(webhook_events) + 1,
            "timestamp": datetime.utcnow().isoformat(),
            "method": request.method,
            "url": str(request.url),
            "headers": headers,
            "body": body.decode('utf-8') if body else None,
            "json_data": json_data,
            "query_params": dict(request.query_params),
            "client_ip": request.client.host if request.client else None
        }
        
        # Store the event
        webhook_events.append(webhook_event)
        
        logger.info(f"Webhook received: {webhook_event['id']}")
        
        # Log the webhook data
        logger.info(f"Headers: {headers}")
        logger.info(f"Body: {body.decode('utf-8') if body else 'Empty'}")
        
        return JSONResponse(
            status_code=200,
            content={
                "message": "Webhook received successfully",
                "event_id": webhook_event["id"],
                "timestamp": webhook_event["timestamp"]
            }
        )
        
    except Exception as e:
        logger.error(f"Error processing webhook: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@app.post("/{webhook_type}")
async def handle_typed_webhook(webhook_type: str, request: Request):
    """
    Typed webhook endpoint for specific webhook types
    """
    try:
        # Get the raw body
        body = await request.body()
        
        # Get headers
        headers = dict(request.headers)
        
        # Parse JSON if possible
        try:
            json_data = json.loads(body.decode('utf-8'))
        except json.JSONDecodeError:
            json_data = None
        
        # Create webhook event record
        webhook_event = {
            "id": len(webhook_events) + 1,
            "type": webhook_type,
            "timestamp": datetime.utcnow().isoformat(),
            "method": request.method,
            "url": str(request.url),
            "headers": headers,
            "body": body.decode('utf-8') if body else None,
            "json_data": json_data,
            "query_params": dict(request.query_params),
            "client_ip": request.client.host if request.client else None
        }
        
        # Store the event
        webhook_events.append(webhook_event)
        
        logger.info(f"Typed webhook received: {webhook_type} - Event ID: {webhook_event['id']}")
        

        
            # Generic handler for unknown types
        return JSONResponse(
            status_code=200,
            content={
                "message": f"Webhook of type '{webhook_type}' received successfully",
                "event_id": webhook_event["id"],
                "timestamp": webhook_event["timestamp"]
            }
        )
        
    except Exception as e:
        logger.error(f"Error processing typed webhook: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


    """Handle Slack webhooks"""
    logger.info("Processing Slack webhook")
    # Add your Slack webhook logic here
    return JSONResponse(
        status_code=200,
        content={"message": "Slack webhook processed successfully"}
    )


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=True,
        log_level="info"
    )
