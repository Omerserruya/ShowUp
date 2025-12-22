"""
Telegram sender for OTP codes
"""

import logging
import os
from typing import Optional

import requests

logger = logging.getLogger(__name__)


class TelegramSender:
    """Handles sending OTP codes via Telegram."""
    
    def __init__(self):
        self.bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
        self.chat_id = os.getenv("TELEGRAM_CHAT_ID")
        
        if not self.bot_token:
            logger.warning("TELEGRAM_BOT_TOKEN not set, Telegram sending will be disabled")
        if not self.chat_id:
            logger.warning("TELEGRAM_CHAT_ID not set, Telegram sending will be disabled")
    
    def send_message(self, text: str) -> bool:
        """
        Send a message via Telegram.
        
        Args:
            text: Message text to send
            
        Returns:
            True if successful, False otherwise
        """
        if not self.bot_token or not self.chat_id:
            logger.error("Telegram credentials not configured")
            return False
        
        try:
            url = f"https://api.telegram.org/bot{self.bot_token}/sendMessage"
            payload = {
                "chat_id": self.chat_id,
                "text": text,
                "parse_mode": "HTML"
            }
            
            response = requests.post(url, json=payload, timeout=10)
            response.raise_for_status()
            
            logger.info("Successfully sent message via Telegram")
            return True
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to send Telegram message: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error sending Telegram message: {e}")
            return False


# Global instance
_telegram_sender: Optional[TelegramSender] = None


def get_telegram_sender() -> TelegramSender:
    """Get or create Telegram sender instance."""
    global _telegram_sender
    if _telegram_sender is None:
        _telegram_sender = TelegramSender()
    return _telegram_sender


def send_otp_via_telegram(phone: str, code: str) -> bool:
    """
    Send OTP code via Telegram.
    
    Args:
        phone: Phone number (currently not used, sent to fixed chat)
        code: OTP code to send
        
    Returns:
        True if successful, False otherwise
    """
    sender = get_telegram_sender()
    
    # Format message
    message = f"🔐 <b>OTP Code</b>\n\n"
    message += f"Code: <code>{code}</code>\n"
    message += f"Phone: {phone}"
    
    return sender.send_message(message)

