"""Host onboarding: "send a test to me" + the invitation-round summary.

    GET  /events/{event_id}/invitation-round
    POST /events/{event_id}/test-send          {campaign_id?}

The test send renders the round's REAL message - the same catalog template the
campaign-worker would resolve, filled by the same VariableResolver with the
event's real values - for a pseudo-guest named after the host, and hands it to
outpost on the PRIORITY lane addressed to the CURRENT USER's own phone.

It is deliberately outside the campaign machinery: no round is consumed, no
messages_sent row is claimed (no campaign_id / guest_id on the envelope) and no
RSVP conversation is opened for the host (no event_id on the envelope), so
tapping "מגיעים" on a test message never counts as an RSVP.

Publishing: core-service does not ship pika, so the publisher uses pika when it
is importable and otherwise the RabbitMQ management HTTP API (same broker, same
durable queue, same JSON body outpost already consumes). Both need
RABBITMQ_USER / RABBITMQ_PASSWORD (or RABBITMQ_DEFAULT_USER / _PASS) in the
core-service environment; without them the endpoint answers 503.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from collections import defaultdict, deque
from typing import Any, Deque, Dict, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.authz import require_event_permission
from app.crud import event as event_crud
from app.db import get_db
from app.models.models import Campaign, Event
from shared.auth.deps import get_current_user_id
from shared.domain.roles import Action

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/events", tags=["test-send"])

# ---------------------------------------------------------------------------
# Rate limit: max N test sends per event per rolling hour (per process).
# ---------------------------------------------------------------------------

TEST_SEND_LIMIT = int(os.getenv("TEST_SEND_LIMIT_PER_HOUR", "5"))
_WINDOW_SECONDS = 3600
_sends: Dict[str, Deque[float]] = defaultdict(deque)
_sends_lock = threading.Lock()


def _rate_limit_check(event_id: str, now: Optional[float] = None) -> None:
    now = time.time() if now is None else now
    with _sends_lock:
        q = _sends[event_id]
        while q and now - q[0] > _WINDOW_SECONDS:
            q.popleft()
        if len(q) >= TEST_SEND_LIMIT:
            raise HTTPException(
                status_code=429,
                detail=f"אפשר לשלוח עד {TEST_SEND_LIMIT} הודעות בדיקה בשעה. נסו שוב מאוחר יותר.",
            )


def _rate_limit_record(event_id: str, now: Optional[float] = None) -> None:
    with _sends_lock:
        _sends[event_id].append(time.time() if now is None else now)


def _reset_rate_limit() -> None:  # tests
    with _sends_lock:
        _sends.clear()


# ---------------------------------------------------------------------------
# Publisher (outpost priority lane)
# ---------------------------------------------------------------------------

class PublishUnavailable(RuntimeError):
    """The broker is not configured / reachable from core-service."""


def _priority_queue() -> str:
    return os.getenv("OUTPOST_PRIORITY_QUEUE") or "outpost_priority_queue"


def _broker_creds():
    user = os.getenv("RABBITMQ_USER") or os.getenv("RABBITMQ_DEFAULT_USER")
    pw = os.getenv("RABBITMQ_PASSWORD") or os.getenv("RABBITMQ_DEFAULT_PASS")
    return user, pw


def publish_outpost_priority(message: Dict[str, Any]) -> None:
    """Publish one outpost envelope to the durable priority queue."""
    queue = _priority_queue()
    host = os.getenv("RABBITMQ_HOST")
    user, pw = _broker_creds()
    if not host or not user or not pw:
        raise PublishUnavailable("RABBITMQ_HOST/USER/PASSWORD not configured on core-service")
    try:
        from shared.obs import inject_into
        inject_into(message)
    except Exception:
        pass
    body = json.dumps(message, ensure_ascii=False)
    headers = {"message_type": message.get("message_type", "template")}

    try:
        import pika  # type: ignore
    except ImportError:
        pika = None  # type: ignore

    if pika is not None:
        params = pika.ConnectionParameters(
            host=host, port=int(os.getenv("RABBITMQ_PORT") or 5672),
            credentials=pika.PlainCredentials(user, pw),
            heartbeat=30, blocked_connection_timeout=10, socket_timeout=5,
        )
        conn = pika.BlockingConnection(params)
        try:
            ch = conn.channel()
            ch.queue_declare(queue=queue, durable=True)
            ch.basic_publish(exchange="", routing_key=queue, body=body.encode("utf-8"),
                             properties=pika.BasicProperties(delivery_mode=2, headers=headers))
        finally:
            try:
                conn.close()
            except Exception:
                pass
        return

    # Fallback: RabbitMQ management HTTP API (httpx is already a core dependency).
    import httpx
    port = int(os.getenv("RABBITMQ_MANAGEMENT_PORT", "15672"))
    vhost = os.getenv("RABBITMQ_VHOST", "/").replace("/", "%2F")
    url = f"http://{host}:{port}/api/exchanges/{vhost}/amq.default/publish"
    try:
        r = httpx.post(url, auth=(user, pw), timeout=5.0, json={
            "properties": {"delivery_mode": 2, "headers": headers, "content_type": "application/json"},
            "routing_key": queue,
            "payload": body,
            "payload_encoding": "string",
        })
    except Exception as exc:
        raise PublishUnavailable(f"management API unreachable: {exc}") from exc
    if r.status_code != 200:
        raise PublishUnavailable(f"management API {r.status_code}: {r.text[:200]}")
    if not (r.json() or {}).get("routed"):
        raise PublishUnavailable(f"queue {queue} did not accept the message (not declared?)")


# ---------------------------------------------------------------------------
# Round + template resolution (mirrors campaign-worker)
# ---------------------------------------------------------------------------

def _extra_cols(db: Session, campaign_id) -> Dict[str, Any]:
    """status_reason / campaign_type live in the table (added by other services'
    schema patches) but not on the ORM model - read them raw, best-effort."""
    try:
        row = db.execute(
            text("SELECT status_reason, campaign_type FROM campaigns WHERE id = :id"),
            {"id": str(campaign_id)},
        ).mappings().first()
        return dict(row) if row else {}
    except Exception:
        db.rollback()
        return {}


def _wa_template_row(db: Session, ref: str) -> Optional[dict]:
    try:
        row = db.execute(
            text("SELECT id, name, body, flow_stage, language, components, event_type, "
                 "visibility, lifecycle FROM wa_templates WHERE id = :id"),
            {"id": str(ref)},
        ).mappings().first()
        return dict(row) if row else None
    except Exception:
        db.rollback()
        return None


def _resolve_campaign_template(db: Session, c: Campaign, event_type: Optional[str],
                               campaign_type: Optional[str]):
    """Same order as campaign-worker.process_campaign."""
    from shared.domain.messaging import resolve_template, resolve_stage_channel, prefer_event_variant
    template = None
    if c.stage_id and c.variant_id:
        try:
            template = resolve_stage_channel(c.stage_id, c.variant_id, "whatsapp")
            template = prefer_event_variant(template, event_type)
        except Exception:
            template = None
    if template is None:
        template = resolve_template(
            c.template_key or c.template,
            flow_stage=campaign_type,
            event_type=event_type,
            db_lookup=lambda ref: _wa_template_row(db, ref),
        )
    return template


def _campaign_stage(c: Campaign, template, campaign_type: Optional[str]):
    from shared.domain.messaging import canonical_stage
    return (canonical_stage(c.stage_id) or canonical_stage(campaign_type)
            or (template.flow_stage if template is not None else None)
            or canonical_stage(c.template_key or c.template))


def _pick_invitation_round(db: Session, event: Event):
    """(campaign, template, extras) for the event's invitation round: the
    earliest not-yet-sent invitation, else the latest sent one."""
    from shared.domain.messaging import FlowStage
    campaigns: List[Campaign] = (
        db.query(Campaign).filter(Campaign.event_id == str(event.id)).all()
    )
    found = []
    for c in campaigns:
        extras = _extra_cols(db, c.id)
        t = _resolve_campaign_template(db, c, event.event_type, extras.get("campaign_type"))
        if _campaign_stage(c, t, extras.get("campaign_type")) == FlowStage.INVITATION:
            found.append((c, t, extras))
    if not found:
        return None
    far = 10 ** 12
    unsent = [f for f in found if (f[0].status or "").lower() not in ("sent", "sending", "failed", "cancelled")]
    pool = unsent or found
    pool.sort(key=lambda f: f[0].schedule_time.timestamp() if f[0].schedule_time else far,
              reverse=not unsent)
    return pool[0]


def _event_dict(event: Event) -> Dict[str, Any]:
    return {
        "id": str(event.id),
        "name": event.name,
        "description": event.description,
        "event_date": event.event_date,
        "location": event.location,
        "active": event.active,
        "event_type": event.event_type,
        "subjects": event.subjects,
        "public_slug": event.public_slug,
        "wa_image_url": event.wa_image_url,
        "inviters": event.inviters or [],
        "owners": event.owners or [],
        "account_id": str(event.account_id) if event.account_id else None,
    }


def _mask(phone: str) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    return f"***{digits[-4:]}" if digits else "***"


def _canonical_phone(raw: Optional[str]) -> Optional[str]:
    """E.164 digits (no '+') for an Israeli/international phone, or None."""
    d = "".join(ch for ch in (raw or "") if ch.isdigit())
    if not d:
        return None
    if d.startswith("00"):
        d = d[2:]
    if d.startswith("0"):
        d = "972" + d[1:]
    if len(d) < 10 or len(d) > 15:
        return None
    return d


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

class TestSendIn(BaseModel):
    campaign_id: Optional[uuid.UUID] = None


@router.get("/{event_id}/invitation-round")
def invitation_round(
    event_id: uuid.UUID,
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """The round the host's guests will get first, for the onboarding checklist.
    {round: null} when the event has no invitation round."""
    event = event_crud.get_event(db, event_id)
    require_event_permission(db, event, user_id, Action.CAMPAIGN_READ)
    picked = _pick_invitation_round(db, event)
    if not picked:
        return {"round": None}
    c, t, extras = picked
    try:
        from app.audience import count_audience
        recipients = int(count_audience(db, event_id, c.audience, c.audience_filter))
    except Exception:
        db.rollback()
        recipients = int(c.recipient_count or 0)
    if (c.status or "").lower() == "sent":
        recipients = int(c.recipient_count or recipients)
    return {"round": {
        "campaign_id": str(c.id),
        "name": c.name,
        "status": c.status,
        "status_reason": extras.get("status_reason"),
        "schedule_time": c.schedule_time.isoformat() if c.schedule_time else None,
        "recipients": recipients,
        "template_key": t.key if t is not None else (c.template_key or None),
        "template_title": (t.title if t is not None else None),
        "custom_message": bool(c.custom_message and c.custom_message.strip()),
        "sendable": bool((c.custom_message and c.custom_message.strip()) or (t is not None and t.is_usable)),
    }}


@router.post("/{event_id}/test-send")
def test_send(
    event_id: uuid.UUID,
    payload: TestSendIn = Body(default_factory=TestSendIn),
    db: Session = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Send the round's real message to the current user's phone."""
    event = event_crud.get_event(db, event_id)
    require_event_permission(db, event, user_id, Action.CAMPAIGN_LAUNCH)

    if payload.campaign_id:
        c = db.query(Campaign).filter(Campaign.id == payload.campaign_id,
                                      Campaign.event_id == str(event_id)).first()
        if c is None:
            raise HTTPException(status_code=404, detail="הסבב לא נמצא באירוע הזה")
        extras = _extra_cols(db, c.id)
        template = _resolve_campaign_template(db, c, event.event_type, extras.get("campaign_type"))
    else:
        picked = _pick_invitation_round(db, event)
        if not picked:
            raise HTTPException(status_code=404, detail="עוד אין סבב הזמנה לאירוע הזה")
        c, template, extras = picked

    custom = (c.custom_message or "").strip()
    if not custom:
        if template is None:
            raise HTTPException(status_code=400, detail="לא הצלחנו לזהות את נוסח ההודעה של הסבב הזה")
        if not template.is_usable:
            raise HTTPException(
                status_code=400,
                detail="הנוסח הזה עדיין לא מאושר לשליחה בוואטסאפ לסוג האירוע שלכם. אפשר לבחור נוסח אחר בלוח השליחה.",
            )

    _rate_limit_check(str(event_id))

    from app import user_directory
    me = user_directory.resolve_users_by_ids([user_id]).get(str(user_id)) or {}
    recipient = _canonical_phone(me.get("phone"))
    if not recipient:
        raise HTTPException(status_code=400, detail="לא מצאנו מספר טלפון בחשבון שלכם")

    from shared.domain.messaging import VariableResolver, build_meta_message, build_free_text
    first = (me.get("first_name") or "").strip()
    pseudo_guest = {"name": " ".join(p for p in (first, (me.get("last_name") or "").strip()) if p) or "אורח/ת"}
    resolver = VariableResolver(_event_dict(event), header_image_override=c.header_image_url)
    try:
        if custom:
            message = build_free_text(resolver.render_body(custom, pseudo_guest), recipient=recipient,
                                      event_id=None, campaign_id=None, guest_id=None)
        else:
            message = build_meta_message(template, resolver.values_for(pseudo_guest), recipient=recipient,
                                         event_id=None, campaign_id=None, guest_id=None)
    except Exception as exc:
        logger.warning("test-send build failed event=%s campaign=%s: %s", event_id, c.id, exc)
        raise HTTPException(status_code=400, detail="לא הצלחנו להכין את ההודעה לשליחה")
    # No campaign_id/guest_id/event_id: nothing is claimed in messages_sent and no
    # RSVP conversation opens for the host. Keep traceability in separate keys.
    message["source"] = "test_send"
    message["test_send"] = True
    message["test_event_id"] = str(event_id)
    message["test_campaign_id"] = str(c.id)

    try:
        publish_outpost_priority(message)
    except PublishUnavailable as exc:
        logger.error("test-send publish unavailable: %s", exc)
        raise HTTPException(status_code=503, detail="שליחת בדיקה לא זמינה כרגע. נסו שוב בעוד כמה דקות.")
    except Exception as exc:
        logger.error("test-send publish failed: %s", exc)
        raise HTTPException(status_code=503, detail="שליחת בדיקה לא זמינה כרגע. נסו שוב בעוד כמה דקות.")
    _rate_limit_record(str(event_id))
    return {
        "status": "sent",
        "to": _mask(recipient),
        "campaign_id": str(c.id),
        "delivery": "free_text" if custom else "template",
    }
