"""Context enrichment - attach the who/what/where of a failure automatically.

Two things happen when you set context:

1. Scalar identifiers become Sentry **tags** (searchable/filterable): user_id,
   event_id, campaign_id, guest_id, provider, delivery_status, ... - the exact
   fields the spec lists per domain (user / event / campaign / guest / whatsapp /
   payment / ai / external).
2. The same fields accumulate in a per-flow **bag** (a contextvar dict) that
   `obs.logging.log_event` merges into every structured log and that is mirrored
   onto the Sentry scope, so an exception and the logs around it carry identical
   context without threading it through every call.

Every setter is defensive and only records values that actually exist - "only
include existing values", per the spec. Nothing here sends secrets: identifiers
and phone numbers are deliberate debugging context, and message *content* is
never attached (see obs.scrub).
"""
from __future__ import annotations

import contextvars
from typing import Any, Dict, Optional

_ctx_bag: contextvars.ContextVar[Dict[str, Any]] = contextvars.ContextVar("obs_ctx", default={})


def current_context() -> Dict[str, Any]:
    return dict(_ctx_bag.get() or {})


def clear_context() -> None:
    """Reset flow context - call between requests / messages so one flow's
    context never bleeds into the next."""
    _ctx_bag.set({})
    try:
        import sentry_sdk
        scope = sentry_sdk.get_current_scope()
        scope.clear()
    except Exception:
        pass


def _set_tags(**tags: Any) -> None:
    clean = {k: v for k, v in tags.items() if v is not None and v != ""}
    if not clean:
        return
    bag = dict(_ctx_bag.get() or {})
    bag.update({k: str(v) for k, v in clean.items()})
    _ctx_bag.set(bag)
    try:
        import sentry_sdk
        scope = sentry_sdk.get_current_scope()
        for k, v in clean.items():
            scope.set_tag(k, str(v))
    except Exception:
        pass


def _set_context(section: str, data: Dict[str, Any]) -> None:
    clean = {k: v for k, v in data.items() if v is not None and v != ""}
    if not clean:
        return
    try:
        import sentry_sdk
        sentry_sdk.get_current_scope().set_context(section, clean)
    except Exception:
        pass


# ---- flow / operation ------------------------------------------------------

def set_flow(operation: Optional[str] = None, flow: Optional[str] = None,
             worker: Optional[str] = None) -> None:
    _set_tags(operation=operation, flow=flow, worker=worker)


# ---- user ------------------------------------------------------------------

def set_user(user_id: Optional[Any] = None, role: Optional[str] = None,
             email: Optional[str] = None) -> None:
    _set_tags(user_id=user_id, role=role)
    try:
        import sentry_sdk
        u = {"id": str(user_id)} if user_id else {}
        if role:
            u["role"] = role
        if email:  # only when appropriate - callers gate this
            u["email"] = email
        if u:
            sentry_sdk.get_current_scope().set_user(u)
    except Exception:
        pass


# ---- event -----------------------------------------------------------------

def set_event(event: Any = None, *, event_id=None, event_name=None, plan=None,
              venue_id=None) -> None:
    """Accepts an ORM event or explicit fields."""
    if event is not None:
        event_id = event_id or getattr(event, "id", None)
        event_name = event_name or getattr(event, "name", None)
        plan = plan or getattr(event, "plan_id", None)
        venue_id = venue_id or getattr(event, "account_id", None)
    _set_tags(event_id=event_id, plan=plan, venue_id=venue_id)
    _set_context("event", {"event_id": event_id, "event_name": event_name,
                           "plan": plan, "venue_id": venue_id})


# ---- campaign --------------------------------------------------------------

def set_campaign(*, campaign_id=None, campaign_name=None, stage=None, round=None,
                 variant=None) -> None:
    _set_tags(campaign_id=campaign_id, campaign_stage=stage,
              campaign_round=round, campaign_variant=variant)
    _set_context("campaign", {"campaign_id": campaign_id, "campaign_name": campaign_name,
                              "stage": stage, "round": round, "variant": variant})


# ---- guest -----------------------------------------------------------------

def set_guest(*, guest_id=None, phone=None, party_size=None) -> None:
    _set_tags(guest_id=guest_id)
    _set_context("guest", {"guest_id": guest_id, "phone": phone, "party_size": party_size})


# ---- whatsapp --------------------------------------------------------------

def set_whatsapp(*, phone_number_id=None, recipient=None, template=None, language=None,
                 message_id=None, conversation_id=None, meta_error_code=None,
                 meta_error_message=None, delivery_status=None) -> None:
    _set_tags(phone_number_id=phone_number_id, template=template,
              meta_error_code=meta_error_code, delivery_status=delivery_status)
    _set_context("whatsapp", {
        "phone_number_id": phone_number_id, "recipient": recipient, "template": template,
        "language": language, "message_id": message_id, "conversation_id": conversation_id,
        "meta_error_code": meta_error_code, "meta_error_message": meta_error_message,
        "delivery_status": delivery_status,
    })


# ---- payment ---------------------------------------------------------------

def set_payment(*, payment_id=None, provider=None, status=None, amount=None,
                currency=None, entitlement_id=None) -> None:
    _set_tags(payment_id=payment_id, payment_provider=provider, payment_status=status,
              entitlement_id=entitlement_id)
    _set_context("payment", {"payment_id": payment_id, "provider": provider, "status": status,
                             "amount": amount, "currency": currency,
                             "entitlement_id": entitlement_id})


# ---- ai / assistant --------------------------------------------------------

def set_ai(*, conversation_id=None, tool=None, tool_call=None, assistant_mode=None) -> None:
    _set_tags(tool=tool, assistant_mode=assistant_mode)
    _set_context("ai", {"conversation_id": conversation_id, "tool": tool,
                        "tool_call": tool_call, "assistant_mode": assistant_mode})


# ---- external services -----------------------------------------------------

def set_external(*, provider=None, endpoint=None, status_code=None, latency_ms=None,
                 response_body=None) -> None:
    _set_tags(provider=provider, external_status_code=status_code)
    _set_context("external", {"provider": provider, "endpoint": endpoint,
                              "status_code": status_code, "latency_ms": latency_ms,
                              "response_body": (str(response_body)[:500] if response_body else None)})
