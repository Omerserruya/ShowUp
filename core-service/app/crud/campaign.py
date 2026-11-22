from __future__ import annotations

import logging
import os
import uuid
from typing import Dict, List, Optional, Tuple
import datetime as dt

from sqlalchemy.orm import Session

from app.models.models import Campaign, Event, Guest
from app.schemas.schemas import CampaignCreate, CampaignUpdate

logger = logging.getLogger(__name__)

# Configurable minimum gap between campaigns (in minutes). Defaults to 300 (5h)
# so a missing env var cannot crash the service at import time.
CAMPAIGN_MIN_GAP_MINUTES = int(os.getenv("CAMPAIGN_MIN_GAP_MINUTES") or 300)

# Statuses a client (UI / assistant) may SET. Everything else (processing,
# sending, sent, failed) is owned by the scheduler/worker/finalizer.
CLIENT_SETTABLE_STATUSES = frozenset({"pending", "paused", "draft"})
# A campaign in one of these may still have its status changed by a client.
CLIENT_MUTABLE_STATUSES = frozenset({"pending", "paused", "draft"})
# Stages whose messages only make sense BEFORE the event starts.
_POST_EVENT_STAGES = frozenset({"thank_you"})


class CampaignValidationError(ValueError):
    """A campaign create/update the server refuses (bad status transition,
    schedule after the event, free-text body...). Subclasses ValueError so every
    existing `except ValueError -> 400` caller keeps working."""


NO_RECIPIENTS_MESSAGE = (
    "אי אפשר לשלוח את הסבב: אין אף מוזמן שמתאים לקהל של הסבב הזה. "
    "הוסיפו מוזמנים לרשימה (או שנו את קהל היעד) ונסו שוב."
)


class NoRecipientsError(CampaignValidationError):
    """send-now on a round whose audience is empty. The router maps it to
    400 {code: 'no_recipients', message: <Hebrew>}."""
    code = "no_recipients"

    def __init__(self, message: str = NO_RECIPIENTS_MESSAGE):
        super().__init__(message)
        self.message = message


class SendNowRefused(CampaignValidationError):
    """send-now on a round that is already out (or partly out)."""
    code = "send_now_refused"

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def custom_messages_allowed() -> bool:
    """Free-text (custom_message) campaigns are OFF unless explicitly enabled.

    A campaign is a first contact outside WhatsApp's 24h customer-service
    window, where Meta only accepts approved TEMPLATES - a free-text body is
    rejected for every guest. Kept behind a flag for a future approved-template
    implementation (or a sandbox/test number)."""
    return (os.getenv("ALLOW_CUSTOM_MESSAGE_CAMPAIGNS") or "").strip().lower() in ("1", "true", "yes")


def strip_custom_message(custom_message: Optional[str], *, context: str = "") -> Optional[str]:
    """The custom_message to persist: unchanged when allowed, else None (logged)."""
    if not custom_message or not str(custom_message).strip():
        return None
    if custom_messages_allowed():
        return custom_message
    logger.warning("custom_message ignored on campaign %s: free-text first-contact sends are "
                   "rejected by Meta (set ALLOW_CUSTOM_MESSAGE_CAMPAIGNS=1 to allow)", context or "write")
    return None


def wa_template_row(db: Session, ref) -> Optional[dict]:
    """db_lookup for resolve_template: an event-scoped custom template by id,
    shaped like the worker's `wa_templates` row. A `custom__<key>` ref is an
    admin-authored Template Studio template (custom_templates table)."""
    from shared.domain.messaging.custom_templates import is_custom_ref
    if is_custom_ref(ref):
        from app.custom_templates_store import custom_template_row
        return custom_template_row(db, ref)
    try:
        tid = uuid.UUID(str(ref))
    except (ValueError, TypeError):
        return None
    from app.models.models import WaTemplate
    t = db.query(WaTemplate).filter(WaTemplate.id == tid).first()
    if not t:
        return None
    return {
        "id": str(t.id), "flow_stage": t.flow_stage, "components": t.components,
        "name": t.name, "body": t.body, "language": t.language,
        "event_type": t.event_type, "visibility": t.visibility, "lifecycle": t.lifecycle,
    }


def _resolved_template(db: Session, template_ref):
    try:
        from shared.domain.messaging import resolve_template
        return resolve_template(template_ref, db_lookup=lambda ref: wa_template_row(db, ref))
    except Exception:
        return None


def looks_like_free_text(db: Session, template_ref) -> bool:
    """True when `template` holds a written message rather than a template
    reference (the Messages page used to save custom copy there). Same
    heuristic campaign-worker uses to send it as free text - which Meta rejects."""
    ref = str(template_ref or "")
    if not (" " in ref or "\n" in ref):
        return False
    return _resolved_template(db, ref) is None


def campaign_stage(db: Session, template_ref) -> Optional[str]:
    """Canonical flow-stage id of a campaign's template (catalog or custom DB
    template), or None when it cannot be determined."""
    sid, _ = _stage_variant(template_ref)
    if sid:
        return sid
    t = _resolved_template(db, template_ref)
    fs = getattr(t, "flow_stage", None) if t is not None else None
    if fs is None:
        return None
    return getattr(fs, "value", None) or str(fs)


def derive_audience(db: Session, data) -> Tuple[str, Optional[dict]]:
    """(audience, audience_filter) for a new campaign.

    An audience the client EXPLICITLY sent is kept. Otherwise the campaign's
    stage decides WHO receives it (stage_definitions audience_rule): a reminder
    goes to non-responders, a thank-you to confirmed guests, etc. Without this,
    every round silently defaulted to 'everyone'.
    """
    explicit = getattr(data, "model_fields_set", set()) or set()
    if "audience" in explicit or "audience_filter" in explicit:
        return _aud(data.audience), data.audience_filter
    stage = campaign_stage(db, data.template)
    derived = None
    if stage:
        try:
            from shared.domain.messaging import default_audience_for_stage
            derived = default_audience_for_stage(stage)
        except Exception:
            derived = None
    if derived is None:
        return _aud(data.audience), data.audience_filter
    return derived


def category_and_audience(db: Session, data, template_ref: Optional[str] = None,
                          requested: Optional[str] = None):
    """(category_id, audience, audience_filter) for a round. A template round
    always gets a category, and the category's audience wins over anything the
    client sent (app/round_categories.py). A round with no stage (free text)
    keeps the old derivation."""
    from app.round_categories import category_for, pair_of
    from app.template_placement import effective_stage, own_stage, placed_category
    ref = template_ref if template_ref is not None else data.template
    stage = effective_stage(db, ref, own_stage(db, ref))
    cat = category_for(db, requested if requested is not None else getattr(data, "category_id", None), stage,
                       placed_category(db, ref))
    if cat is None:
        aud, flt = derive_audience(db, data)
        return None, aud, flt
    aud, flt = pair_of(cat)
    return cat["id"], aud, flt


def _as_aware(value: Optional[dt.datetime]) -> Optional[dt.datetime]:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=dt.timezone.utc)


def validate_schedule_vs_event(db: Session, event: Event, template_ref, schedule_time) -> None:
    """A pre-event stage (invitation, reminders, table info...) must not be
    scheduled after the event starts."""
    if schedule_time is None or event is None or getattr(event, "event_date", None) is None:
        return
    stage = campaign_stage(db, template_ref)
    if not stage or stage in _POST_EVENT_STAGES:
        return
    if _as_aware(schedule_time) > _as_aware(event.event_date):
        raise CampaignValidationError(
            "schedule_time is after the event date - a pre-event message must be sent before the event"
        )


def validate_client_status(new_status: Optional[str], current_status: Optional[str] = None) -> None:
    if new_status is None:
        return
    if new_status not in CLIENT_SETTABLE_STATUSES:
        raise CampaignValidationError(
            f"status '{new_status}' cannot be set by a client (allowed: {', '.join(sorted(CLIENT_SETTABLE_STATUSES))})"
        )
    if current_status is not None and current_status != new_status and current_status not in CLIENT_MUTABLE_STATUSES:
        raise CampaignValidationError(
            f"campaign in status '{current_status}' can no longer change status"
        )


def _recipient_count(db: Session, event_id, audience, audience_filter) -> int:
    from app.audience import count_audience
    try:
        return int(count_audience(db, event_id, audience, audience_filter))
    except Exception:
        logger.exception("recipient_count computation failed for event %s", event_id)
        return 0


def refresh_recipient_counts(db: Session, event_id, campaigns=None) -> int:
    """Re-persist recipient_count for an event's not-yet-sent campaigns (the
    guest list changes after a campaign is created). Returns rows changed.
    Caller commits."""
    rows = campaigns if campaigns is not None else (
        db.query(Campaign).filter(Campaign.event_id == str(event_id),
                                  Campaign.status.in_(list(CLIENT_MUTABLE_STATUSES))).all()
    )
    changed = 0
    for c in rows:
        if c.status not in CLIENT_MUTABLE_STATUSES:
            continue
        n = _recipient_count(db, event_id, c.audience, c.audience_filter)
        if (c.recipient_count or 0) != n:
            c.recipient_count = n
            db.add(c)
            changed += 1
    return changed


def _aud(value):
    """Coerce a CampaignAudience enum (or str/None) to its stored string value."""
    return value.value if hasattr(value, "value") else value


def _canonical_key(template_ref) -> Optional[str]:
    """Canonical catalog key for a template reference (SSOT), or None. Stored on
    the campaign so every layer shares one identifier. UUID refs (event-scoped
    custom templates) resolve at send time with a DB lookup, so they stay None
    here - the worker still resolves them correctly."""
    try:
        from shared.domain.messaging import resolve_template
        t = resolve_template(template_ref)
        return t.key if t else None
    except Exception:
        return None


def _stage_variant(template_ref) -> Tuple[Optional[str], Optional[str]]:
    """(stage_id, variant_id) for a campaign's template - the stage-execution
    coordinates. Both resolve back to the same channel template, so this is a
    label on top of delivery, not a behavior change."""
    try:
        from shared.domain.messaging import resolve_template, stage_variant_for_template
        t = resolve_template(template_ref)
        sv = stage_variant_for_template(t.key) if t else None
        return sv if sv else (None, None)
    except Exception:
        return (None, None)


def list_campaigns(
    db: Session,
    event_id: uuid.UUID,
    page: int,
    page_size: int,
    search: Optional[str] = None,
    order_by: Optional[str] = None,
) -> Tuple[List[Campaign], int]:
    query = db.query(Campaign).filter(Campaign.event_id == str(event_id))
    if search:
        like = f"%{search}%"
        query = query.filter(Campaign.name.ilike(like))
    total = query.count()
    
    # Order by schedule_time if requested, otherwise by created_at
    if order_by == "schedule_time":
        items = (
            query.order_by(Campaign.schedule_time.asc().nullslast())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
    else:
        items = (
            query.order_by(Campaign.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
    return items, total


def get_campaign(db: Session, campaign_id: uuid.UUID) -> Optional[Campaign]:
    return db.query(Campaign).filter(Campaign.id == str(campaign_id)).first()


def create_campaign(db: Session, data: CampaignCreate) -> Campaign:
    # ensure event exists
    event = db.query(Event).filter(Event.id == str(data.event_id)).first()
    if not event:
        raise ValueError("event_id does not exist")

    # Enforce minimum gap between campaigns for same event
    if data.schedule_time is not None:
        window_start = data.schedule_time - dt.timedelta(minutes=CAMPAIGN_MIN_GAP_MINUTES)
        window_end = data.schedule_time + dt.timedelta(minutes=CAMPAIGN_MIN_GAP_MINUTES)
        conflict = (
            db.query(Campaign)
            .filter(
                Campaign.event_id == str(data.event_id),
                Campaign.schedule_time != None,
                Campaign.schedule_time >= window_start,
                Campaign.schedule_time <= window_end,
            )
            .first()
        )
        if conflict:
            raise ValueError(f"campaign schedule conflicts with another campaign (min {CAMPAIGN_MIN_GAP_MINUTES} minutes apart)")

    validate_client_status(data.status)
    if looks_like_free_text(db, data.template) and not custom_messages_allowed():
        raise CampaignValidationError(
            "template must be an approved template, not free text - WhatsApp rejects free-text first-contact messages"
        )
    validate_schedule_vs_event(db, event, data.template, data.schedule_time)

    _tkey = _canonical_key(data.template)
    _sid, _vid = _stage_variant(data.template)
    category_id, audience, audience_filter = category_and_audience(db, data)
    campaign = Campaign(
        event_id=str(data.event_id),
        category_id=category_id,
        name=data.name,
        template=data.template,
        template_key=_tkey,
        stage_id=_sid,
        variant_id=_vid,
        custom_message=strip_custom_message(getattr(data, "custom_message", None), context=data.name),
        header_image_url=getattr(data, "header_image_url", None),
        channel=data.channel,
        schedule_time=data.schedule_time,
        status=data.status,
        audience=audience,
        audience_filter=audience_filter,
        # Persisted (not just displayed) - the planner only schedules campaigns
        # with recipient_count > 0 and sizes its daily releases from it.
        # Client-supplied values are ignored.
        recipient_count=_recipient_count(db, data.event_id, audience, audience_filter),
        follow_up_after_hours=data.follow_up_after_hours,
        follow_up_audience=_aud(data.follow_up_audience),
    )
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return campaign


def _campaign_has_messages(db: Session, campaign_id) -> bool:
    """True when any message of this campaign was claimed/sent. messages_sent is
    owned by outpost/worker - looked up in a SAVEPOINT so a database without it
    (fresh test DB) cannot abort the caller's transaction."""
    from sqlalchemy import text
    try:
        with db.begin_nested():
            row = db.execute(text("SELECT 1 FROM messages_sent WHERE campaign_id = CAST(:cid AS uuid) LIMIT 1"),
                             {"cid": str(campaign_id)}).first()
            return row is not None
    except Exception:
        return False


def _clear_releases(db: Session, campaign_id) -> None:
    """Drop the planner's leftover release rows of a round being re-sent, so the
    planner (or the legacy scheduler path) picks it up again. Best-effort."""
    from sqlalchemy import text
    try:
        with db.begin_nested():
            db.execute(text("DELETE FROM campaign_releases WHERE campaign_id = CAST(:cid AS uuid)"),
                       {"cid": str(campaign_id)})
    except Exception:
        pass


def _check_send_now_allowed(db: Session, campaign: Campaign) -> bool:
    """Whether "send now" may run on this round. Returns True when it is a RETRY
    of a round that finished without sending anything (failed / empty audience),
    which also needs its stale planner releases cleared. Raises SendNowRefused
    otherwise."""
    status = (campaign.status or "").lower()
    if status in CLIENT_MUTABLE_STATUSES:
        return False
    if status in ("processing", "sending"):
        raise SendNowRefused("הסבב כבר בשליחה ברגעים אלה.")
    if status in ("failed", "sent"):
        if status == "sent" and (campaign.recipient_count or 0) > 0:
            raise SendNowRefused("הסבב כבר נשלח.")
        if _campaign_has_messages(db, campaign.id):
            raise SendNowRefused("חלק מההודעות של הסבב כבר יצאו - אי אפשר לשלוח אותו שוב. צרו סבב חדש.")
        return True
    raise SendNowRefused(f"אי אפשר לשלוח סבב במצב '{campaign.status}'.")


def update_campaign(db: Session, campaign: Campaign, data: CampaignUpdate) -> Campaign:
    send_now = bool(getattr(data, "send_now", None))
    retry = False
    if send_now:
        # The server owns the send instant and the resulting status; a client
        # status in the same payload is ignored.
        retry = _check_send_now_allowed(db, campaign)
        data = data.model_copy(update={
            "status": None,
            "schedule_time": dt.datetime.now(dt.timezone.utc),
        })
    else:
        validate_client_status(data.status, campaign.status)
    event = db.query(Event).filter(Event.id == str(campaign.event_id)).first()
    template_ref = data.template if data.template is not None else campaign.template
    if data.template is not None and data.template != campaign.template:
        if looks_like_free_text(db, data.template) and not custom_messages_allowed():
            raise CampaignValidationError(
                "template must be an approved template, not free text - WhatsApp rejects free-text first-contact messages"
            )
    if data.schedule_time is not None or (data.template is not None and data.template != campaign.template):
        validate_schedule_vs_event(db, event, template_ref,
                                   data.schedule_time if data.schedule_time is not None else campaign.schedule_time)
    audience_changed = False
    if data.name is not None:
        campaign.name = data.name
    if data.template is not None:
        if data.template != campaign.template:
            # Keep the stage-execution coordinates in sync with the template:
            # campaign-worker resolves stage_id/variant_id FIRST, so a stale pair
            # would keep sending the OLD template after the owner changed it.
            campaign.template_key = _canonical_key(data.template)
            campaign.stage_id, campaign.variant_id = _stage_variant(data.template)
        campaign.template = data.template
    if data.channel is not None:
        campaign.channel = data.channel
    if data.schedule_time is not None and send_now:
        # "Send now" is an explicit owner action - the spacing rule protects
        # guests from two SCHEDULED rounds landing together, not this.
        campaign.schedule_time = data.schedule_time
    elif data.schedule_time is not None:
        # enforce minimum gap spacing on update
        window_start = data.schedule_time - dt.timedelta(minutes=CAMPAIGN_MIN_GAP_MINUTES)
        window_end = data.schedule_time + dt.timedelta(minutes=CAMPAIGN_MIN_GAP_MINUTES)
        conflict = (
            db.query(Campaign)
            .filter(
                Campaign.event_id == campaign.event_id,
                Campaign.id != campaign.id,
                Campaign.schedule_time != None,
                Campaign.schedule_time >= window_start,
                Campaign.schedule_time <= window_end,
            )
            .first()
        )
        if conflict:
            raise ValueError(f"campaign schedule conflicts with another campaign (min {CAMPAIGN_MIN_GAP_MINUTES} minutes apart)")
        campaign.schedule_time = data.schedule_time
    if data.status is not None:
        if data.status != campaign.status:
            # The worker's reason described the OLD status (e.g. why it was a draft).
            campaign.status_reason = None
        campaign.status = data.status
    if data.audience is not None:
        audience_changed = audience_changed or _aud(data.audience) != campaign.audience
        campaign.audience = _aud(data.audience)
        # A plain audience (everyone/confirmed/...) carries no filter; keep a
        # stale custom filter from lingering on the row.
        if campaign.audience != "custom" and data.audience_filter is None:
            campaign.audience_filter = None
    if data.audience_filter is not None:
        audience_changed = audience_changed or data.audience_filter != campaign.audience_filter
        campaign.audience_filter = data.audience_filter
    if data.follow_up_after_hours is not None:
        campaign.follow_up_after_hours = data.follow_up_after_hours
    if data.follow_up_audience is not None:
        campaign.follow_up_audience = _aud(data.follow_up_audience)
    if data.header_image_url is not None:
        campaign.header_image_url = data.header_image_url or None
    # The category decides the audience - re-applied on every edit, so a
    # client-sent audience can never override it. A template change to another
    # stage moves the round to that stage's built-in category.
    if campaign.custom_message is None:
        from app.round_categories import category_for, get_category, pair_of
        from app.template_placement import effective_stage, own_stage, placed_category
        stage = effective_stage(db, campaign.template, own_stage(db, campaign.template))
        requested = data.category_id
        if requested is None:
            current = get_category(db, campaign.category_id)
            requested = campaign.category_id if current and current["base_stage"] == stage else None
        cat = category_for(db, requested, stage, placed_category(db, campaign.template))
        if cat is not None:
            aud, flt = pair_of(cat)
            audience_changed = audience_changed or (aud, flt) != (campaign.audience, campaign.audience_filter)
            campaign.category_id, campaign.audience, campaign.audience_filter = cat["id"], aud, flt
    if send_now:
        n = _recipient_count(db, campaign.event_id, campaign.audience, campaign.audience_filter)
        if n <= 0:
            db.rollback()   # discard every field change of this request
            raise NoRecipientsError()
        if retry:
            _clear_releases(db, campaign.id)
            campaign.processing_attempts = 0
        campaign.recipient_count = n
        campaign.status = "pending"
        campaign.status_reason = None
    elif campaign.status in CLIENT_MUTABLE_STATUSES and (audience_changed or not campaign.recipient_count):
        campaign.recipient_count = _recipient_count(db, campaign.event_id, campaign.audience,
                                                    campaign.audience_filter)
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return campaign


def delete_campaign(db: Session, campaign: Campaign) -> None:
    db.delete(campaign)
    db.commit()


def create_campaigns_bulk(db: Session, event_id: uuid.UUID, items: List[CampaignCreate]) -> List[Campaign]:
    # ensure event exists
    event = db.query(Event).filter(Event.id == str(event_id)).first()
    if not event:
        raise ValueError("event_id does not exist")

    created: List[Campaign] = []
    # Deduplicate within the same request by (name, template, channel, schedule_time)
    seen_keys: set[tuple] = set()
    for idx, data in enumerate(items):
        key = (data.name, data.template, data.channel, data.schedule_time)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        validate_client_status(data.status)
        if looks_like_free_text(db, data.template) and not custom_messages_allowed():
            raise CampaignValidationError(
                f"campaign '{data.name}': template must be an approved template, not free text"
            )
        try:
            validate_schedule_vs_event(db, event, data.template, data.schedule_time)
        except CampaignValidationError as e:
            # Bulk is the provisioning path (a PAID order's rounds): one bad
            # item must not lose the whole batch. Skip it loudly.
            logger.error("bulk campaign '%s' skipped for event %s: %s", data.name, event_id, e)
            continue
        _b_sid, _b_vid = _stage_variant(data.template)
        try:
            _b_cat, _b_aud, _b_filter = category_and_audience(db, data)
        except ValueError as e:
            logger.error("bulk campaign '%s' skipped for event %s: %s", data.name, event_id, e)
            continue
        c = Campaign(  # noqa: E128
            category_id=_b_cat,
            template_key=_canonical_key(data.template),
            stage_id=_b_sid,
            variant_id=_b_vid,
            event_id=str(event_id),
            name=data.name,
            template=data.template,
            custom_message=strip_custom_message(getattr(data, "custom_message", None), context=data.name),
            header_image_url=getattr(data, "header_image_url", None),
            channel=data.channel,
            schedule_time=data.schedule_time,
            status=data.status,
            audience=_b_aud,
            audience_filter=_b_filter,
            recipient_count=_recipient_count(db, event_id, _b_aud, _b_filter),
            follow_up_after_hours=data.follow_up_after_hours,
            follow_up_audience=_aud(data.follow_up_audience),
        )
        # Enforce spacing: check conflicts within DB and within batch
        # BUT: allow multiple campaigns with same schedule_time if they have different template/name
        if c.schedule_time is not None:
            window_start = c.schedule_time - dt.timedelta(minutes=CAMPAIGN_MIN_GAP_MINUTES)
            window_end = c.schedule_time + dt.timedelta(minutes=CAMPAIGN_MIN_GAP_MINUTES)
            # Check DB conflicts - only if same template AND name (different templates can share time)
            conflict_db = (
                db.query(Campaign)
                .filter(
                    Campaign.event_id == str(event_id),
                    Campaign.schedule_time != None,
                    Campaign.schedule_time >= window_start,
                    Campaign.schedule_time <= window_end,
                    Campaign.template == c.template,
                    Campaign.name == c.name,
                )
                .first()
            )
            # Check batch conflicts - only if same template AND name
            conflict_batch = any(
                (x.schedule_time is not None 
                 and window_start <= x.schedule_time <= window_end
                 and x.template == c.template
                 and x.name == c.name)
                for x in created
            )
            if conflict_db:
                continue
            if conflict_batch:
                continue
        db.add(c)
        created.append(c)
    db.commit()
    for c in created:
        db.refresh(c)
    return created


def delete_campaigns_by_event(db: Session, event_id: uuid.UUID) -> int:
    # returns number of rows deleted
    q = db.query(Campaign).filter(Campaign.event_id == str(event_id))
    count = q.count()
    q.delete(synchronize_session=False)
    db.commit()
    return count


# The three numbers an owner actually asks about after a round goes out:
# how many RECEIVED it, how many SAW it, how many ANSWERED. They come from one
# table - `messages_sent`, one row per (campaign, guest) - so they can never
# disagree with each other the way two sources would.
_STATS_SQL = """
    SELECT
        campaign_id,
        COUNT(*)                                                      AS attempted,
        COUNT(*) FILTER (WHERE status = 'queued')                     AS queued,
        COUNT(*) FILTER (WHERE status = 'failed')                     AS failed,
        COUNT(*) FILTER (WHERE status IN ('accepted','delivered','read')) AS accepted,
        COUNT(*) FILTER (WHERE status IN ('delivered','read'))        AS delivered,
        COUNT(*) FILTER (WHERE status = 'read')                       AS read,
        COUNT(*) FILTER (WHERE replied_at IS NOT NULL)                AS replied
    FROM messages_sent
    WHERE campaign_id = ANY(CAST(:campaign_ids AS uuid[]))
    GROUP BY campaign_id
"""

# Read receipts recorded before `messages_sent` carried wamids live only in
# `messages_log`. Used as a FLOOR for read_count so historical campaigns don't
# suddenly report zero reads; new traffic is fully covered by messages_sent.
_LEGACY_READ_SQL = """
    SELECT ml_outgoing.campaign_id,
           COUNT(DISTINCT COALESCE(ml_status.guest_phone,
                                   ml_outgoing.guest_phone,
                                   ml_outgoing.wa_message_id)) AS read_count
    FROM messages_log ml_outgoing
    INNER JOIN messages_log ml_status
        ON ml_status.wa_message_id = ml_outgoing.wa_message_id
        AND ml_status.direction = 'status'
        AND ml_status.status = 'read'
    WHERE ml_outgoing.campaign_id = ANY(CAST(:campaign_ids AS uuid[]))
        AND ml_outgoing.direction = 'outgoing'
    GROUP BY ml_outgoing.campaign_id
"""


def _empty_stats() -> dict:
    return {
        "sent_count": 0, "delivered_count": 0, "read_count": 0, "replied_count": 0,
        "failed_count": 0, "queued_count": 0, "attempted_count": 0,
    }


def _shape_stats(row, legacy_read: int) -> dict:
    """Turn one raw count row into the funnel the API promises.

    Two monotonicity repairs, both from real WhatsApp behaviour rather than
    tidiness:
      * a guest who ANSWERED provably received the message, even if Meta's
        delivery receipt never arrived;
      * read receipts can be switched off entirely, so `read` is NOT a superset
        of `replied` and is never used to bound it.
    """
    accepted = int(row["accepted"] or 0)
    replied = int(row["replied"] or 0)
    # The legacy floor counts DISTINCT phones, which on odd historical data can
    # exceed the messages we know Meta accepted - cap it so the funnel can never
    # report more reads than sends.
    read = max(int(row["read"] or 0), legacy_read)
    if accepted:
        read = min(read, accepted)
    delivered = max(int(row["delivered"] or 0), read, replied)
    return {
        # Accepted by Meta - the honest "sent" number (not "enqueued").
        "sent_count": accepted,
        # Reached the recipient's device.
        "delivered_count": min(delivered, accepted) if accepted else delivered,
        # Opened. Undercounts by design when the guest disabled read receipts.
        "read_count": read,
        # Answered the round. Independent of read - see above.
        "replied_count": replied,
        # Partial-failure visibility.
        "failed_count": int(row["failed"] or 0),
        "queued_count": int(row["queued"] or 0),
        "attempted_count": int(row["attempted"] or 0),
    }


def _legacy_read_counts(db: Session, ids: List[str]) -> Dict[str, int]:
    """Legacy read receipts from `messages_log`, or {} when unavailable.

    `messages_log` belongs to webhook-worker, not to core - core reads it purely
    for backwards compatibility and must work on a database where it was never
    created. The lookup runs in a SAVEPOINT so a missing table cannot abort the
    caller's transaction along with it.
    """
    from sqlalchemy import text

    try:
        with db.begin_nested():
            return {
                str(r[0]): int(r[1] or 0)
                for r in db.execute(text(_LEGACY_READ_SQL), {"campaign_ids": ids}).fetchall()
            }
    except Exception:
        return {}


def get_campaign_stats_bulk(db: Session, campaign_ids: List[uuid.UUID]) -> Dict[str, dict]:
    """Stats for many campaigns in two queries, keyed by campaign id string.

    Campaigns with no messages yet get a zeroed row rather than being absent, so
    every campaign carries a stats block at every moment of its life - before
    sending, mid-send and after - and the UI never has to guess.
    """
    from sqlalchemy import text

    ids = [str(c) for c in campaign_ids]
    if not ids:
        return {}

    out = {cid: _empty_stats() for cid in ids}
    legacy = _legacy_read_counts(db, ids)
    for row in db.execute(text(_STATS_SQL), {"campaign_ids": ids}).mappings().all():
        cid = str(row["campaign_id"])
        out[cid] = _shape_stats(row, legacy.get(cid, 0))

    # A campaign sent before `messages_sent` existed has no rows at all, only
    # read receipts in the log. Reconstruct the whole funnel from them - a read
    # receipt proves the message was sent and delivered - so the row stays
    # internally consistent instead of reporting reads against zero sends.
    for cid, read_count in legacy.items():
        if cid in out and out[cid]["attempted_count"] == 0 and read_count:
            out[cid].update({
                "attempted_count": read_count,
                "sent_count": read_count,
                "delivered_count": read_count,
                "read_count": read_count,
            })
    return out


def get_campaign_stats(db: Session, campaign_id: uuid.UUID) -> dict:
    """The delivery/engagement funnel for one campaign.

    Returns received (`delivered_count`), seen (`read_count`) and answered
    (`replied_count`), plus `sent_count` / `failed_count` / `queued_count` /
    `attempted_count` for the send itself.
    """
    return get_campaign_stats_bulk(db, [campaign_id]).get(str(campaign_id), _empty_stats())


