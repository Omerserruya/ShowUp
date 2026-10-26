import os
import json
import logging
import threading
import time
from typing import Dict, Any

from tenacity import retry, stop_after_attempt, wait_exponential

import psycopg2
import pika

from db import (
    connect as db_connect,
    is_alive as db_is_alive,
    fetch_campaign_by_id,
    fetch_event_by_id,
    fetch_wa_template,
    claim_message,
    release_message_claim,
    mark_message_failed,
    mark_campaign_completed,
    create_follow_up_campaign,
    record_message_usage,
    mark_release_sent,
    campaign_has_open_releases,
    mark_campaign_status,
    finish_campaign,
    fail_open_releases,
    revert_release,
    guest_still_sendable,
    campaign_has_messages,
    release_is_final,
    park_campaign_no_guests,
)
from mq import connect as mq_connect, publish_outpost
from audience import select_guests_by_audience
from phone import canonical_phone, mask_phone

# Single source of truth - the worker holds NO template definitions of its own.
from shared.domain.messaging import (
    resolve_template,
    resolve_stage_channel,
    canonical_stage,
    FlowStage,
    prefer_event_variant,
    VariableResolver,
    build_meta_message,
    build_free_text,
    DeliveryKind,
)


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

# Stages whose replies the RSVP bot must handle: outpost logs these messages with
# conversation state 'rsvp_invite' (so a guest who earlier declined can still tap
# "coming" on a reminder - review 3.6).
RSVP_STAGES = {FlowStage.INVITATION, FlowStage.REMINDER, FlowStage.FINAL_REMINDER}

# Bounded redelivery for unexpected processing failures, then dead-letter.
MAX_ATTEMPTS = int(os.getenv("CAMPAIGN_MAX_ATTEMPTS", "3"))
ATTEMPT_HEADER = "x-campaign-attempt"

try:
    from zoneinfo import ZoneInfo as _ZoneInfo
    _LOCAL_TZ = _ZoneInfo(os.getenv("SEND_WINDOW_TZ", "Asia/Jerusalem"))
except Exception:  # no tzdata
    from datetime import timezone as _tz, timedelta as _td
    _LOCAL_TZ = _tz(_td(hours=2))


def _event_date_passed(event_date) -> bool:
    """True when the event's (local) calendar day is before today (local)."""
    from datetime import datetime, timezone, date
    if not event_date:
        return False
    if isinstance(event_date, datetime):
        if event_date.tzinfo is None:
            event_date = event_date.replace(tzinfo=timezone.utc)
        ev_day = event_date.astimezone(_LOCAL_TZ).date()
    elif isinstance(event_date, date):
        ev_day = event_date
    else:
        return False
    return ev_day < datetime.now(timezone.utc).astimezone(_LOCAL_TZ).date()


# --- observability helpers (all best-effort; never break a send) ------------
def _obs_new_message():
    try:
        from shared.obs import clear_context
        clear_context()
    except Exception:
        pass


def _obs_adopt(message):
    try:
        from shared.obs import adopt_from, set_flow
        adopt_from(message)
        set_flow(worker="campaign-worker", flow="campaign")
    except Exception:
        pass


def _obs_capture(exc, **ctx):
    try:
        from shared.obs import capture
        capture(exc, **ctx)
    except Exception:
        pass


def _obs_set_event(ev):
    try:
        from shared.obs import set_event
        set_event(event_id=ev.get("id"), event_name=ev.get("name"),
                  plan=ev.get("plan_id"), venue_id=ev.get("account_id"))
    except Exception:
        pass


def _obs_set_campaign(c):
    try:
        from shared.obs import set_campaign
        set_campaign(campaign_id=c.get("id"), campaign_name=c.get("name"),
                     stage=c.get("stage_id"), variant=c.get("variant_id"),
                     round=c.get("campaign_type"))
    except Exception:
        pass


def _obs_set_guest(g):
    try:
        from shared.obs import set_guest
        set_guest(guest_id=g.get("id"), phone=mask_phone(g.get("phone")),
                  party_size=g.get("guest_count") or g.get("import_count"))
    except Exception:
        pass


def _obs_log(event, **fields):
    try:
        from shared.obs import log_event
        log_event(event, **fields)
    except Exception:
        pass


def _stop(conn, campaign_id, release_id, status, reason, logger, **log):
    """Every early exit writes a status + reason - never leaves 'processing'.

    status 'failed'   terminal (cancels remaining planner batches)
    status 'pending'  hand back (e.g. event inactive) - legacy path reverts the
                      campaign, release path reverts just the batch.
    """
    log_json(logger, logging.WARNING if status == "failed" else logging.INFO,
             f"Campaign not sent: {reason}", campaign_id=campaign_id, release_id=release_id,
             status=status, **log)
    if not campaign_id:
        return
    if status == "pending":
        if release_id is not None:
            revert_release(conn, release_id)
        else:
            finish_campaign(conn, campaign_id, "pending", reason, only_if=["processing"])
        return
    finish_campaign(conn, campaign_id, status, reason)
    if status == "failed":
        fail_open_releases(conn, campaign_id)


# Stages where "nobody to send to" means the owner has not added guests yet -
# such a round is parked as a draft instead of being marked sent to 0.
NO_GUEST_GUARD_STAGES = {FlowStage.INVITATION, FlowStage.SAVE_THE_DATE}


def _record_ops(message, **kw):
    try:
        from shared.ops.errors import record_error
        record_error("campaign-worker", message, **kw)
    except Exception:
        pass


def process_campaign(conn, channel, campaign_id: str, limit: int = None, release_id: str = None,
                     final: bool = False):
    """Send a campaign. When the planner released this as a batch, `limit` caps how
    many not-yet-messaged recipients go out now and `release_id` identifies the
    batch to mark done. Without them, legacy behaviour (send everyone) is kept.
    The campaign's FINAL batch (`final`, or is_final on the release row) has no
    limit: it sends every remaining eligible guest, so a stale planned count can
    never leave guests un-messaged. The audience is always recomputed here at
    send time; already-messaged guests are skipped by the claim.
    Workers NEVER decide timing/volume - they only execute what was released."""
    logger = logging.getLogger("worker")

    campaign_data = fetch_campaign_by_id(conn, campaign_id)
    if not campaign_data:
        log_json(logger, logging.ERROR, "Campaign not found", campaign_id=campaign_id)
        return

    # Status gate. Legacy path: the scheduler claimed it as 'processing'.
    # Release path: the campaign stays 'pending' between batches. Anything else
    # (paused / cancelled / already sending) means the owner or another run got
    # there first - do not send.
    status = (campaign_data.get("status") or "").lower()
    expected = "pending" if release_id is not None else "processing"
    if status != expected:
        log_json(logger, logging.INFO, "Campaign not in a sendable state; skipping",
                 campaign_id=campaign_id, status=status, expected=expected, release_id=release_id)
        if release_id is not None and status in ("paused", "draft"):
            revert_release(conn, release_id)   # resumes when un-paused
        return

    if release_id is not None and (final or release_is_final(conn, release_id)):
        limit = None   # last batch: everyone still eligible

    event_id = str(campaign_data["event_id"])
    template_name = campaign_data["template"]

    event_data = fetch_event_by_id(conn, event_id)
    if not event_data:
        _stop(conn, campaign_id, release_id, "failed", "event not found", logger, event_id=event_id)
        return
    # Attach event + campaign context so any failure below is fully described.
    _obs_set_event(event_data)
    _obs_set_campaign(campaign_data)

    if not event_data.get("active", True):
        _stop(conn, campaign_id, release_id, "pending", "event inactive", logger, event_id=event_id)
        return

    # Resolve the ONE template definition from the catalog (SSOT). Accepts every
    # legacy reference form (canonical key / Meta name / stage label / DB UUID),
    # so a stored UUID is never sent to Meta as a template name.
    custom_message = campaign_data.get("custom_message")
    template = None
    template_ref = campaign_data.get("template_key") or template_name
    if not custom_message:
        # Stage-first resolution: a campaign is "run Stage X, variant Y".
        stage_id = campaign_data.get("stage_id")
        variant_id = campaign_data.get("variant_id")
        if stage_id and variant_id:
            template = resolve_stage_channel(stage_id, variant_id, "whatsapp")
            # Prefer the event-type variant actually approved on Meta.
            template = prefer_event_variant(template, event_data.get("event_type"))
        if template is None:
            template = resolve_template(
                template_ref,
                flow_stage=campaign_data.get("campaign_type"),
                event_type=event_data.get("event_type"),
                db_lookup=lambda ref: fetch_wa_template(conn, ref),
            )
        if template is None:
            # The Messages page stores a CUSTOM (free-text) message in the `template`
            # field itself. If it looks like a written message, send it as free text.
            if template_ref and (" " in str(template_ref) or "\n" in str(template_ref)):
                custom_message = str(template_ref)
                log_json(logger, logging.INFO, "Unresolved template treated as custom free-text",
                         campaign_id=campaign_id)
            else:
                _stop(conn, campaign_id, release_id, "failed",
                      f"template '{template_name}' did not resolve in catalog", logger)
                return

    # Stage of this round (drives the RSVP log-state and the event-date rule).
    stage = (canonical_stage(campaign_data.get("stage_id"))
             or canonical_stage(campaign_data.get("campaign_type"))
             or (template.flow_stage if template is not None else None)
             or canonical_stage(template_ref))

    # Never message guests about an event that is over - except the thank-you.
    if stage != FlowStage.THANK_YOU and _event_date_passed(event_data.get("event_date")):
        _stop(conn, campaign_id, release_id, "failed", "event date has passed", logger,
              event_date=event_data.get("event_date"))
        return

    var_resolver = VariableResolver(
        event_data,
        header_image_override=campaign_data.get("header_image_url"),
    )

    try:
        guests = select_guests_by_audience(
            conn, event_id, campaign_data.get("audience"), campaign_data.get("audience_filter")
        )
        log_json(
            logger, logging.INFO, "Audience selected guests",
            campaign_id=campaign_id, template=template_name,
            delivery="free_text" if custom_message else (template.delivery.value if template else None),
            audience=campaign_data.get("audience"), guest_count=len(guests),
        )
    except (psycopg2.OperationalError, psycopg2.InterfaceError):
        raise   # transient: bounded redelivery
    except Exception as e:
        _stop(conn, campaign_id, release_id, "failed", f"audience selection failed: {e}", logger)
        return

    # 0-guest guard: an invitation / save-the-date with nobody to send to (and
    # nothing sent before) is not "sent to 0" - it goes back to draft so the
    # owner sees it was never delivered (status_reason='no_guests').
    if not guests and stage in NO_GUEST_GUARD_STAGES and not campaign_has_messages(conn, campaign_id):
        park_campaign_no_guests(conn, campaign_id)
        log_json(logger, logging.WARNING, "Campaign has no eligible guests; parked as draft",
                 campaign_id=campaign_id, stage=stage.value, release_id=release_id)
        _obs_log("campaign.no_guests", level="warning", stage=stage.value)
        _record_ops(f"campaign {campaign_id} ({stage.value}) had 0 eligible guests at send time; "
                    f"returned to draft (no_guests)",
                    severity="warning", error_type="campaign_no_guests", event_id=event_id,
                    context={"campaign_id": campaign_id, "stage": stage.value,
                             "audience": campaign_data.get("audience")})
        return

    # Messages handed to outpost this batch. Named 'queued' deliberately: it is
    # NOT a delivery count. Real delivery is resolved per-message in
    # messages_sent by outpost, from Meta's response.
    queued_count = 0
    failed_count = 0
    skipped_opted_out = 0

    _obs_log("campaign.started", recipients=len(guests), limit=limit, release_id=release_id)

    for guest in guests:
        _obs_set_guest(guest)
        if limit is not None and queued_count >= limit:
            break

        guest_id = str(guest["id"])

        # Re-check opt-out at send time (the guest may have replied STOP since
        # the audience was selected). Before the claim, so nothing is recorded.
        if not guest_still_sendable(conn, guest_id):
            skipped_opted_out += 1
            continue

        recipient = canonical_phone(guest.get("phone"))
        if recipient is None:
            # Undeliverable number: record it (owner sees who was not reached)
            # instead of handing Meta garbage.
            failed_count += 1
            mark_message_failed(conn, campaign_id, guest_id, "invalid_phone",
                                "guest phone is not a valid phone number")
            continue

        # Claim BEFORE building/publishing - the idempotency barrier.
        if not claim_message(conn, campaign_id, guest_id):
            continue

        try:
            if custom_message:
                message = build_free_text(
                    var_resolver.render_body(custom_message, guest),
                    recipient=recipient, event_id=event_id, campaign_id=campaign_id, guest_id=guest_id,
                )
            else:
                message = build_meta_message(
                    template, var_resolver.values_for(guest),
                    recipient=recipient, event_id=event_id, campaign_id=campaign_id, guest_id=guest_id,
                )
            if stage is not None:
                message["stage"] = stage.value
                if stage in RSVP_STAGES:
                    message["log_state"] = "rsvp_invite"
        except Exception as e:
            failed_count += 1
            mark_message_failed(conn, campaign_id, guest_id, "build_failed", str(e))
            log_json(logger, logging.ERROR, "Message building failed", campaign_id=campaign_id,
                     guest_id=guest_id, error=str(e))
            continue

        try:
            publish_outpost(channel, OUTPOST_QUEUE, message)
            queued_count += 1
        except Exception as e:
            # Enqueue failed, so nothing downstream will ever resolve this claim.
            release_message_claim(conn, campaign_id, guest_id)
            failed_count += 1
            log_json(logger, logging.ERROR, "Failed to enqueue message", campaign_id=campaign_id,
                     guest_id=guest_id, error=str(e))
            if isinstance(e, (pika.exceptions.AMQPError,)):
                raise   # channel is gone: bounded redelivery re-runs (claims make it idempotent)

    # Finalize. Planner-released batch vs legacy whole-campaign send.
    campaign_complete = True
    if release_id is not None:
        mark_release_sent(conn, release_id, queued_count)
        campaign_complete = not campaign_has_open_releases(conn, campaign_id)

    if campaign_complete:
        if queued_count == 0 and not campaign_has_messages(conn, campaign_id):
            # Nobody to send to (empty audience / all opted out). 'sending' would
            # hang forever - finalize_campaigns only resolves campaigns with rows.
            finish_campaign(conn, campaign_id, "sent", "empty audience", recipient_count=0)
        elif release_id is not None:
            # All batches dispatched; finalize_campaigns promotes 'sending' to
            # 'sent'/'failed' from the per-message outcomes.
            mark_campaign_status(conn, campaign_id, "sending")
        else:
            mark_campaign_completed(conn, campaign_id, queued_count)

    if failed_count and not queued_count:
        _obs_log("campaign.failed", level="warning", queued=queued_count, build_failures=failed_count)
    else:
        _obs_log("campaign.completed", queued=queued_count, build_failures=failed_count)

    if queued_count:
        record_message_usage(conn, event_data.get("account_id"), event_id, queued_count, ref_id=campaign_id)

    # Optional single follow-up - only once the WHOLE campaign is dispatched
    # (not after every planner batch).
    follow_hours = campaign_data.get("follow_up_after_hours")
    follow_audience = campaign_data.get("follow_up_audience")
    if campaign_complete and follow_hours and follow_audience:
        try:
            try:
                est = len(select_guests_by_audience(conn, event_id, follow_audience, None))
            except Exception:
                est = 0
            new_id = create_follow_up_campaign(conn, campaign_data, int(follow_hours), follow_audience,
                                               recipient_count=est)
            log_json(logger, logging.INFO, "Scheduled follow-up campaign",
                     campaign_id=campaign_id, follow_up_id=new_id,
                     after_hours=follow_hours, audience=follow_audience)
        except Exception as e:
            log_json(logger, logging.ERROR, "Failed to schedule follow-up", campaign_id=campaign_id, error=str(e))

    log_json(
        logger, logging.INFO, "Campaign processed",
        campaign_id=campaign_id, template=template_name, release_id=release_id,
        queued=queued_count, failed=failed_count, skipped_opted_out=skipped_opted_out,
    )


class _State:
    conn = None


def _ensure_conn(state, logger):
    if not db_is_alive(state.conn):
        try:
            if state.conn is not None:
                state.conn.close()
        except Exception:
            pass
        log_json(logger, logging.WARNING, "Postgres connection lost; reconnecting")
        state.conn = db_connect()
    return state.conn


def _republish_or_dead_letter(ch, method, properties, body, queue_name, campaign_id, error, state, logger):
    """Bounded retry: re-publish with an attempt counter (basic_nack cannot carry
    one), then dead-letter + fail the campaign with a reason."""
    headers = dict((properties.headers or {}) if properties else {})
    attempt = int(headers.get(ATTEMPT_HEADER) or 0) + 1
    if attempt < MAX_ATTEMPTS:
        headers[ATTEMPT_HEADER] = attempt
        # Short pause (heartbeat-safe) so a transient DB/broker blip can clear.
        ch.connection.sleep(min(5 * attempt, 30))
        ch.basic_publish(exchange="", routing_key=queue_name, body=body,
                         properties=pika.BasicProperties(delivery_mode=2, headers=headers))
        ch.basic_ack(delivery_tag=method.delivery_tag)
        log_json(logger, logging.WARNING, "Campaign message re-queued", campaign_id=campaign_id,
                 attempt=attempt, max_attempts=MAX_ATTEMPTS)
        return
    dlq = f"{queue_name}.dlq"
    headers["x-campaign-error"] = str(error)[:300]
    ch.queue_declare(queue=dlq, durable=True)
    ch.basic_publish(exchange="", routing_key=dlq, body=body,
                     properties=pika.BasicProperties(delivery_mode=2, headers=headers))
    ch.basic_ack(delivery_tag=method.delivery_tag)
    log_json(logger, logging.ERROR, "Campaign message dead-lettered", campaign_id=campaign_id,
             attempts=attempt, dlq=dlq)
    if campaign_id:
        try:
            conn = _ensure_conn(state, logger)
            finish_campaign(conn, campaign_id, "failed",
                            f"processing failed {attempt} times: {error}"[:500],
                            only_if=["processing", "pending"])
        except Exception as e:
            log_json(logger, logging.ERROR, "Could not mark dead-lettered campaign failed",
                     campaign_id=campaign_id, error=str(e))


def main():
    configure_logging()
    logger = logging.getLogger("worker")

    try:
        from shared.obs import bootstrap
        bootstrap("campaign-worker")
    except Exception:
        pass

    state = _State()
    state.conn = db_connect()
    try:
        from db import ensure_schema
        ensure_schema(state.conn)
    except Exception as e:
        log_json(logger, logging.ERROR, "Failed ensuring schema", error=str(e))

    queue_name = os.getenv("CAMPAIGNS_QUEUE")

    def callback(ch, method, properties, body):
        _obs_new_message()  # reset flow context for this delivery
        campaign_id = None
        try:
            message = json.loads(body)
            _obs_adopt(message)
            campaign_id = message.get("campaign_id")
            limit = message.get("limit")
            release_id = message.get("release_id")
            final = bool(message.get("final"))
            if not campaign_id:
                log_json(logger, logging.ERROR, "Missing campaign_id in message")
                ch.basic_ack(delivery_tag=method.delivery_tag)
                return
        except Exception as e:
            log_json(logger, logging.ERROR, "Invalid message JSON", error=str(e))
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

        try:
            conn = _ensure_conn(state, logger)
            process_campaign(conn, ch, campaign_id,
                             limit=int(limit) if limit is not None else None,
                             release_id=release_id, final=final)
            ch.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as e:
            log_json(logger, logging.ERROR, "Campaign processing failed", campaign_id=campaign_id,
                     error=str(e))
            _obs_capture(e, operation="process_campaign", flow="campaign",
                         worker="campaign-worker", campaign_id=campaign_id)
            if isinstance(e, (psycopg2.OperationalError, psycopg2.InterfaceError)):
                try:
                    state.conn.close()
                except Exception:
                    pass
                state.conn = None
            _republish_or_dead_letter(ch, method, properties, body, queue_name, campaign_id, e,
                                      state, logger)

    # Survive broker restarts: reconnect and resume consuming instead of exiting
    # with the campaign queue unattended.
    while True:
        try:
            rabbit = mq_connect()
            channel = rabbit.channel()
            channel.queue_declare(queue=queue_name, durable=True)
            channel.basic_qos(prefetch_count=1)
            channel.basic_consume(queue=queue_name, on_message_callback=callback)
            log_json(logger, logging.INFO, "Campaign worker started", queue=queue_name,
                     outpost_queue=OUTPOST_QUEUE)
            channel.start_consuming()
        except (pika.exceptions.AMQPError, ConnectionError, OSError) as e:
            log_json(logger, logging.ERROR, "RabbitMQ connection lost; reconnecting", error=str(e))
            time.sleep(5)


if __name__ == "__main__":
    main()
