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
)
from mq import connect as mq_connect, publish_outpost
from audience import select_guests_by_audience

# Single source of truth - the worker holds NO template definitions of its own.
from shared.domain.messaging import (
    resolve_template,
    resolve_stage_channel,
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
        set_guest(guest_id=g.get("id"), phone=g.get("phone"),
                  party_size=g.get("guest_count") or g.get("import_count"))
    except Exception:
        pass


def _obs_log(event, **fields):
    try:
        from shared.obs import log_event
        log_event(event, **fields)
    except Exception:
        pass


def process_campaign(conn, channel, campaign_id: str, limit: int = None, release_id: str = None):
    """Send a campaign. When the planner released this as a batch, `limit` caps how
    many not-yet-messaged recipients go out now and `release_id` identifies the
    batch to mark done. Without them, legacy behaviour (send everyone) is kept.
    Workers NEVER decide timing/volume - they only execute what was released."""
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
    # Attach event + campaign context so any failure below is fully described.
    _obs_set_event(event_data)
    _obs_set_campaign(campaign_data)

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

    # Resolve the ONE template definition from the catalog (SSOT). Accepts every
    # legacy reference form (canonical key / Meta name / stage label / DB UUID),
    # so a stored UUID is never sent to Meta as a template name.
    custom_message = campaign_data.get("custom_message")
    template = None
    if not custom_message:
        # Stage-first resolution: a campaign is "run Stage X, variant Y". Resolve the
        # channel implementation from the stage catalog. This yields the SAME Template
        # as the legacy key path, so delivery is byte-identical.
        stage_id = campaign_data.get("stage_id")
        variant_id = campaign_data.get("variant_id")
        if stage_id and variant_id:
            template = resolve_stage_channel(stage_id, variant_id, "whatsapp")
            # The stage/variant path yields the BASE template; prefer the event-type
            # variant actually approved on Meta (e.g. reminder -> reminder__wedding).
            template = prefer_event_variant(template, event_data.get("event_type"))
        # Fallback: legacy campaigns addressed by template key (or a custom DB UUID).
        if template is None:
            template_ref = campaign_data.get("template_key") or template_name
            template = resolve_template(
                template_ref,
                flow_stage=campaign_data.get("campaign_type"),
                # Prefer the event-type variant actually approved on Meta
                # (e.g. final_reminder_gentle__wedding) over the base key.
                event_type=event_data.get("event_type"),
                db_lookup=lambda ref: fetch_wa_template(conn, ref),
            )
        if template is None:
            # The Messages page stores a CUSTOM (free-text) message in the `template`
            # field itself. If the value doesn't resolve to a catalog template but
            # looks like a written message (contains whitespace), send it as free
            # text rather than dropping the campaign.
            if template_ref and (" " in str(template_ref) or "\n" in str(template_ref)):
                custom_message = str(template_ref)
                log_json(logger, logging.INFO, "Unresolved template treated as custom free-text",
                         campaign_id=campaign_id)
            else:
                log_json(logger, logging.ERROR, "Template did not resolve in catalog; skipping",
                         campaign_id=campaign_id, template=template_name)
                return

    # One variable resolver per event (canonical variables; no Meta slot numbers).
    # A campaign-specific header image (image-header templates) overrides the default.
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
    except Exception as e:
        log_json(logger, logging.ERROR, "Audience selection failed", campaign_id=campaign_id, audience=campaign_data.get("audience"), error=str(e))
        return

    # Messages handed to outpost this batch. Named 'queued' deliberately: it is
    # NOT a delivery count. Real delivery is resolved per-message in
    # messages_sent by outpost, from Meta's response.
    queued_count = 0
    failed_count = 0

    _obs_log("campaign.started", recipients=len(guests), limit=limit, release_id=release_id)

    for guest in guests:
        _obs_set_guest(guest)
        # Planner batch cap: stop once this release's quota is filled. Remaining
        # recipients are covered by the campaign's other releases (later days).
        if limit is not None and queued_count >= limit:
            break

        guest_id = str(guest["id"]) if isinstance(guest["id"], (str,)) else str(guest["id"])

        # Claim BEFORE building/publishing. The claim is the idempotency barrier:
        # losing it means another worker (or an earlier run of this release)
        # already owns this guest.
        if not claim_message(conn, campaign_id, guest_id):
            continue

        # Build the outpost message: a custom message goes out as free text; every
        # other campaign resolves through the catalog's Meta mapping. Both share
        # one envelope - no duplicated delivery logic, language is data-driven.
        try:
            recipient = str(guest.get("phone"))
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
        except Exception as e:
            # Persist the failure against the claim we already hold, so an
            # undeliverable template shows up in the campaign's stats instead of
            # only in the logs.
            failed_count += 1
            mark_message_failed(conn, campaign_id, guest_id, "build_failed", str(e))
            log_json(logger, logging.ERROR, "Message building failed", campaign_id=campaign_id, guest_id=guest_id, error=str(e))
            continue

        try:
            publish_outpost(channel, OUTPOST_QUEUE, message)
            # The message is QUEUED, not sent. outpost promotes it to ACCEPTED
            # once Meta actually takes it, or to FAILED with Meta's error.
            queued_count += 1
        except Exception as e:
            # Enqueue failed, so nothing downstream will ever resolve this claim.
            # Release it so a retry can pick the guest up again.
            release_message_claim(conn, campaign_id, guest_id)
            failed_count += 1
            log_json(logger, logging.ERROR, "Failed to enqueue message", campaign_id=campaign_id, guest_id=guest_id, error=str(e))

    # Finalize. Planner-released batch vs legacy whole-campaign send:
    try:
        if release_id is not None:
            # Record this batch, then complete the campaign only when no more
            # batches are outstanding (a multi-day campaign stays 'pending' between
            # its releases so the scheduler keeps releasing the remaining days).
            mark_release_sent(conn, release_id, queued_count)
            if not campaign_has_open_releases(conn, campaign_id):
                # All batches dispatched, but delivery is still unresolved -
                # finalize_campaigns promotes this to 'sent'/'failed' from the
                # per-message outcomes.
                mark_campaign_status(conn, campaign_id, "sending")
        else:
            mark_campaign_completed(conn, campaign_id, queued_count)
    except Exception as e:
        log_json(
            logger,
            logging.ERROR,
            "Failed to update campaign status to sent",
            campaign_id=campaign_id,
            error=str(e),
        )

    # Lifecycle: campaign dispatch done. 'sent' means queued to Outpost; true
    # delivery is resolved later from Meta receipts (see finalize_campaigns).
    if failed_count and not queued_count:
        _obs_log("campaign.failed", level="warning", queued=queued_count, build_failures=failed_count)
    else:
        _obs_log("campaign.completed", queued=queued_count, build_failures=failed_count)

    # Phase 10: meter messages sent (internal cost metric, never a customer quota).
    if queued_count:
        record_message_usage(conn, event_data.get("account_id"), event_id, queued_count, ref_id=campaign_id)

    # Optional single follow-up (Phase 6): schedule one more round to a sub-audience
    # (typically 'no_response') N hours later. Not a sequence engine.
    follow_hours = campaign_data.get("follow_up_after_hours")
    follow_audience = campaign_data.get("follow_up_audience")
    if follow_hours and follow_audience:
        try:
            new_id = create_follow_up_campaign(conn, campaign_data, int(follow_hours), follow_audience)
            log_json(logger, logging.INFO, "Scheduled follow-up campaign",
                     campaign_id=campaign_id, follow_up_id=new_id,
                     after_hours=follow_hours, audience=follow_audience)
        except Exception as e:
            log_json(logger, logging.ERROR, "Failed to schedule follow-up", campaign_id=campaign_id, error=str(e))

    log_json(
        logger,
        logging.INFO,
        "Campaign processed",
        campaign_id=campaign_id,
        template=template_name,
        queued=queued_count,
        failed=failed_count,
    )


def main():
    configure_logging()
    logger = logging.getLogger("worker")

    try:
        from shared.obs import bootstrap
        bootstrap("campaign-worker")
    except Exception:
        pass

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
        _obs_new_message()  # reset flow context for this delivery
        try:
            message = json.loads(body)
            _obs_adopt(message)  # bind the correlation id that rode the message
            campaign_id = message.get("campaign_id")
            # Planner batch fields (absent for legacy whole-campaign releases).
            limit = message.get("limit")
            release_id = message.get("release_id")
            if not campaign_id:
                log_json(logger, logging.ERROR, "Missing campaign_id in message")
                ch.basic_ack(delivery_tag=method.delivery_tag)
                return
        except Exception as e:
            log_json(logger, logging.ERROR, "Invalid message JSON", error=str(e))
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

        try:
            process_campaign(conn, channel, campaign_id,
                             limit=int(limit) if limit is not None else None,
                             release_id=release_id)
            ch.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as e:
            log_json(logger, logging.ERROR, "Campaign processing failed", error=str(e))
            # Unexpected campaign-processing failure -> Sentry (with correlation +
            # campaign context already on the scope). Expected business errors are
            # filtered out by obs.capture.
            _obs_capture(e, operation="process_campaign", flow="campaign",
                         worker="campaign-worker", campaign_id=campaign_id)
            # Nack with requeue for transient errors
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

    channel.basic_qos(prefetch_count=1)
    channel.basic_consume(queue=queue_name, on_message_callback=callback)

    log_json(logger, logging.INFO, "Campaign worker started", queue=queue_name, outpost_queue=OUTPOST_QUEUE)
    channel.start_consuming()


if __name__ == "__main__":
    main()


