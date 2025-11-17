"""
WhatsApp Business Cloud API Sender

Handles sending messages via WhatsApp Business Cloud API using Facebook Graph API.
"""

import os
import logging
from typing import Dict, Any, List
from datetime import datetime

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type


class WhatsAppSender:
    """Handles WhatsApp message sending via Business Cloud API."""
    
    def __init__(self):
        self.logger = logging.getLogger("whatsapp_sender")
        # Clean the API token to ensure it's ASCII-safe
        raw_token = os.getenv("WA_API_B")
        self.api_token = raw_token.encode('utf-8').decode('ascii', errors='ignore') if raw_token else None
        self.phone_id = os.getenv("WA_PHONE_ID")
        self.base_url = f"https://graph.facebook.com/v22.0/{self.phone_id}/messages"
        
        if not self.api_token or not self.phone_id:
            raise ValueError("WA_API_B and WA_PHONE_ID environment variables are required")
    
    def _build_template_payload(self, recipient: str, template_name: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """Build WhatsApp template message payload."""
        
        # Convert parameters dict to ordered list of text parameters
        # Sort by numeric keys to ensure correct order (1, 2, 3, ...)
        param_list = []
        
        # Helper function to extract numeric key for sorting
        def get_sort_key(item):
            key = item[0]
            try:
                # If key is a numeric string, convert to int for proper sorting
                if isinstance(key, str) and key.isdigit():
                    return int(key)
                # If key is already an int, use it directly
                elif isinstance(key, int):
                    return key
                else:
                    # Non-numeric keys go to the end
                    return float('inf')
            except (ValueError, TypeError):
                return float('inf')
        
        try:
            # Sort by numeric keys to ensure correct order
            sorted_items = sorted(parameters.items(), key=get_sort_key)
        except Exception:
            # Fallback to original order if sorting fails
            sorted_items = list(parameters.items())
        
        for key, value in sorted_items:
            # Convert value to string, handle None/empty values
            # WhatsApp API requires non-empty strings, so use a space if empty
            if value is None:
                text_value = " "
            elif isinstance(value, str) and not value.strip():
                text_value = " "
            else:
                text_value = str(value)
            
            param_list.append({
                "type": "text",
                "text": text_value
            })
        
        # Set language code: "reminder" template uses English, all others use Hebrew
        language_code = "en" if template_name == "reminder" else "he"
        
        payload = {
            "messaging_product": "whatsapp",
            "to": recipient,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": language_code},
                "components": [
                    {
                        "type": "body",
                        "parameters": param_list
                    }
                ]
            }
        }
        
        return payload
    
    def _build_text_payload(self, recipient: str, text: str) -> Dict[str, Any]:
        """Build WhatsApp text message payload."""
        
        payload = {
            "messaging_product": "whatsapp",
            "to": recipient,
            "type": "text",
            "text": {
                "body": text
            }
        }
        
        return payload
    
    def _build_interactive_payload(self, recipient: str, interactive: Dict[str, Any]) -> Dict[str, Any]:
        """Build WhatsApp interactive message payload."""
        
        payload = {
            "messaging_product": "whatsapp",
            "to": recipient,
            "type": "interactive",
            "interactive": interactive
        }
        
        return payload
    
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError))
    )
    async def send_template_message(self, recipient: str, template_name: str, parameters: Dict[str, Any]) -> Dict[str, Any]:
        """
        Send a WhatsApp template message.
        
        Args:
            recipient: Phone number in international format
            template_name: WhatsApp template name
            parameters: Template parameters as key-value pairs
            
        Returns:
            Response from WhatsApp API
            
        Raises:
            httpx.HTTPStatusError: If API request fails
            httpx.RequestError: If network error occurs
        """
        
        payload = self._build_template_payload(recipient, template_name, parameters)
        
        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json"
        }
        
        self.logger.info(
            "Sending WhatsApp message",
            extra={
                "recipient": recipient,
                "template": template_name,
                "parameter_count": len(parameters),
                "parameters": parameters,
                "payload": payload
            }
        )
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                self.base_url,
                json=payload,
                headers=headers
            )
            
            # Log the response for debugging - ALWAYS log errors
            if response.status_code >= 400:
                try:
                    error_data = response.json()
                except:
                    error_data = {"raw_response": response.text}
                
                self.logger.error(
                    "WhatsApp API Error Response",
                    extra={
                        "status_code": response.status_code,
                        "url": str(response.url),
                        "request_payload": payload,
                        "error_response": error_data,
                        "response_text": response.text,
                        "phone_id": self.phone_id
                    }
                )
            else:
                self.logger.debug(
                    "WhatsApp API response",
                    extra={
                        "status_code": response.status_code,
                        "response_text": response.text[:500]  # Limit log size
                    }
                )
            
            # Handle specific error cases
            if response.status_code == 404:
                self.logger.error(
                    "WhatsApp API 404 Error - Phone Number ID not found",
                    extra={
                        "phone_id": self.phone_id,
                        "url": self.base_url,
                        "response": response.text[:500]
                    }
                )
                raise httpx.HTTPStatusError(
                    f"Phone Number ID {self.phone_id} not found. Please check WA_PHONE_ID environment variable.",
                    request=response.request,
                    response=response
                )
            elif response.status_code == 401:
                self.logger.error(
                    f"WhatsApp API 401 Error - Invalid access token {response.text }",
                    extra={
                        "phone_id": self.phone_id,
                        "response": response.text[:500]
                    }
                )
                raise httpx.HTTPStatusError(
                    "Invalid WhatsApp Business API token. Please check WA_API_B environment variable.",
                    request=response.request,
                    response=response
                )
            
            response.raise_for_status()
            
            response_data = response.json()
            
            self.logger.info(
                "WhatsApp message sent successfully",
                extra={
                    "recipient": recipient,
                    "template": template_name,
                    "message_id": response_data.get("messages", [{}])[0].get("id", "unknown")
                }
            )
            
            return response_data
    
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError))
    )
    async def send_text_message(self, recipient: str, text: str) -> Dict[str, Any]:
        """
        Send a WhatsApp text message.
        
        Args:
            recipient: Phone number in international format
            text: Text message content
            
        Returns:
            Response from WhatsApp API
            
        Raises:
            httpx.HTTPStatusError: If API request fails
            httpx.RequestError: If network error occurs
        """
        
        payload = self._build_text_payload(recipient, text)
        
        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json"
        }
        
        self.logger.info(
            "Sending WhatsApp text message",
            extra={
                "recipient": recipient,
                "text_length": len(text)
            }
        )
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                self.base_url,
                json=payload,
                headers=headers
            )
            
            # Log the response for debugging - ALWAYS log errors
            if response.status_code >= 400:
                self.logger.error(
                    "WhatsApp API Error Response",
                    extra={
                        "status_code": response.status_code,
                        "url": str(response.url),
                        "headers": dict(response.headers),
                        "request_payload": payload,
                        "response_text": response.text,
                        "phone_id": self.phone_id
                    }
                )
            else:
                self.logger.debug(
                    "WhatsApp API response",
                    extra={
                        "status_code": response.status_code,
                        "response_text": response.text[:500]  # Limit log size
                    }
                )
            
            # Handle specific error cases
            if response.status_code == 404:
                self.logger.error(
                    "WhatsApp API 404 Error - Phone Number ID not found",
                    extra={
                        "phone_id": self.phone_id,
                        "url": self.base_url,
                        "response": response.text[:500]
                    }
                )
                raise httpx.HTTPStatusError(
                    f"Phone Number ID {self.phone_id} not found. Please check WA_PHONE_ID environment variable.",
                    request=response.request,
                    response=response
                )
            elif response.status_code == 401:
                self.logger.error(
                    f"WhatsApp API 401 Error - Invalid access token {response.text }",
                    extra={
                        "phone_id": self.phone_id,
                        "response": response.text[:500]
                    }
                )
                raise httpx.HTTPStatusError(
                    "Invalid WhatsApp Business API token. Please check WA_API_B environment variable.",
                    request=response.request,
                    response=response
                )
            
            response.raise_for_status()
            
            response_data = response.json()
            
            self.logger.info(
                "WhatsApp text message sent successfully",
                extra={
                    "recipient": recipient,
                    "message_id": response_data.get("messages", [{}])[0].get("id", "unknown")
                }
            )
            
            return response_data
    
    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError))
    )
    async def send_interactive_message(self, recipient: str, interactive: Dict[str, Any]) -> Dict[str, Any]:
        """
        Send a WhatsApp interactive message.
        
        Args:
            recipient: Phone number in international format
            interactive: Interactive message structure with type, body, and action
            
        Returns:
            Response from WhatsApp API
            
        Raises:
            httpx.HTTPStatusError: If API request fails
            httpx.RequestError: If network error occurs
        """
        
        payload = self._build_interactive_payload(recipient, interactive)
        
        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json"
        }
        
        self.logger.info(
            "Sending WhatsApp interactive message",
            extra={
                "recipient": recipient,
                "interactive_type": interactive.get("type"),
                "button_count": len(interactive.get("action", {}).get("buttons", []))
            }
        )
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                self.base_url,
                json=payload,
                headers=headers
            )
            
            # Log the response for debugging - ALWAYS log errors
            if response.status_code >= 400:
                self.logger.error(
                    "WhatsApp API Error Response",
                    extra={
                        "status_code": response.status_code,
                        "url": str(response.url),
                        "headers": dict(response.headers),
                        "request_payload": payload,
                        "response_text": response.text,
                        "phone_id": self.phone_id
                    }
                )
            else:
                self.logger.debug(
                    "WhatsApp API response",
                    extra={
                        "status_code": response.status_code,
                        "response_text": response.text[:500]  # Limit log size
                    }
                )
            
            # Handle specific error cases
            if response.status_code == 404:
                self.logger.error(
                    "WhatsApp API 404 Error - Phone Number ID not found",
                    extra={
                        "phone_id": self.phone_id,
                        "url": self.base_url,
                        "response": response.text[:500]
                    }
                )
                raise httpx.HTTPStatusError(
                    f"Phone Number ID {self.phone_id} not found. Please check WA_PHONE_ID environment variable.",
                    request=response.request,
                    response=response
                )
            elif response.status_code == 401:
                self.logger.error(
                    f"WhatsApp API 401 Error - Invalid access token {response.text }",
                    extra={
                        "phone_id": self.phone_id,
                        "response": response.text[:500]
                    }
                )
                raise httpx.HTTPStatusError(
                    "Invalid WhatsApp Business API token. Please check WA_API_B environment variable.",
                    request=response.request,
                    response=response
                )
            
            response.raise_for_status()
            
            response_data = response.json()
            
            self.logger.info(
                "WhatsApp interactive message sent successfully",
                extra={
                    "recipient": recipient,
                    "message_id": response_data.get("messages", [{}])[0].get("id", "unknown")
                }
            )
            
            return response_data
    
    async def send_batch(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Send multiple WhatsApp messages in batch.
        
        Args:
            messages: List of message dicts with 'recipient', 'template', 'parameters'
            
        Returns:
            List of response dicts
        """
        results = []
        
        for message in messages:
            try:
                result = await self.send_message(
                    recipient=message["recipient"],
                    template_name=message["template"],
                    parameters=message["parameters"]
                )
                results.append({
                    "success": True,
                    "message": message,
                    "response": result
                })
                
            except Exception as e:
                self.logger.error(
                    "Failed to send WhatsApp message",
                    extra={
                        "recipient": message.get("recipient"),
                        "template": message.get("template"),
                        "error": str(e)
                    }
                )
                results.append({
                    "success": False,
                    "message": message,
                    "error": str(e)
                })
        
        return results
    
    