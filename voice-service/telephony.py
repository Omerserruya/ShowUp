"""Twilio Programmable Voice - outbound calls via the REST API (no SDK)."""
from __future__ import annotations

import os
from typing import Optional

import httpx

API = "https://api.twilio.com/2010-04-01"


class TelephonyError(RuntimeError):
    pass


def account_sid() -> str:
    return (os.getenv("TWILIO_ACCOUNT_SID") or "").strip()


def auth_token() -> str:
    return (os.getenv("TWILIO_AUTH_TOKEN") or "").strip()


def from_number() -> str:
    return (os.getenv("TWILIO_FROM_NUMBER") or "").strip()


def configured() -> bool:
    return bool(account_sid() and auth_token() and from_number())


def place_call(to: str, answer_url: str, status_url: str, *, amd_url: Optional[str] = None,
               timeout_sec: int = 25, time_limit_sec: int = 180) -> str:
    """Start a call; Twilio fetches `answer_url` for TwiML once it connects.
    With `amd_url`, answering-machine detection runs ASYNC: the opening plays the
    moment the guest picks up and the verdict arrives at `amd_url` (sync AMD
    held ~7s of dead air after "hello"). Without it, AMD runs before the answer
    webhook (AnsweredBy on it)."""
    if not configured():
        raise TelephonyError("Twilio is not configured")
    data = {
        "To": to, "From": from_number(), "Url": answer_url, "Method": "POST",
        "StatusCallback": status_url, "StatusCallbackMethod": "POST",
        "StatusCallbackEvent": "completed",
        "Timeout": str(timeout_sec), "TimeLimit": str(time_limit_sec),
        "MachineDetection": "Enable",
    }
    if amd_url:
        data.update({"AsyncAmd": "true", "AsyncAmdStatusCallback": amd_url,
                     "AsyncAmdStatusCallbackMethod": "POST"})
    r = httpx.post(f"{API}/Accounts/{account_sid()}/Calls.json", data=data,
                   auth=(account_sid(), auth_token()), timeout=20)
    if r.status_code >= 400:
        try:
            msg = r.json().get("message")
        except ValueError:
            msg = r.text[:200]
        raise TelephonyError(f"Twilio {r.status_code}: {msg}")
    sid: Optional[str] = r.json().get("sid")
    if not sid:
        raise TelephonyError("Twilio returned no call sid")
    return sid


def hangup(sid: str) -> None:
    """End a live call (voicemail detected after the opening started)."""
    r = httpx.post(f"{API}/Accounts/{account_sid()}/Calls/{sid}.json", data={"Status": "completed"},
                   auth=(account_sid(), auth_token()), timeout=10)
    if r.status_code >= 400:
        raise TelephonyError(f"Twilio hangup {r.status_code}")
