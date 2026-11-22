"""Give every event its message rounds the moment it can have them.

The wizard computes a round plan in the browser and carries it through the paid
order, but an event created any other way (gift link, admin, venue) started with
NO rounds - the host had to build them by hand. This fills the same plan on the
server (shared/domain/round_plan.py) for any event that has a date and no rounds
yet. It never touches an event that already has rounds, so a wizard order's own
choices always win.

Phone-call rounds are planned by voice-service from the same module.
"""
from __future__ import annotations

import datetime as dt
import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import Campaign, Event
from shared.domain.messaging import BUILTIN_CATALOG
from shared.domain.messaging.catalog import TemplateCategory
from shared.domain.messaging.stage_definitions import default_variant_for, _variant_of
from shared.domain.round_plan import message_rounds

logger = logging.getLogger(__name__)


def default_template_for(stage: str, event_type: Optional[str], db: Optional[Session] = None) -> Optional[str]:
    """The template a default round uses: deliverable for this event type, no
    image header to fill in, the recommended style first. A template the admin
    moved to another category (app/template_placement.py) counts for THAT
    category's stage, and an approved Studio copy that replaces it is used
    instead of the original."""
    from app.routers.catalog import _sendable_event_types
    et = (event_type or "wedding").lower()
    sendable = _sendable_event_types()
    moved: dict = {}
    swaps: dict = {}
    if db is not None:
        from app.round_categories import get_category
        from app.template_placement import placements, replacements
        for fam, cat_id in placements(db).items():
            cat = get_category(db, cat_id)
            if cat:
                moved[fam] = cat["base_stage"]
        swaps = replacements(db)

    def stage_of(t) -> str:
        return moved.get(t.key.split("__", 1)[0], t.flow_stage.value)

    options = [t for t in BUILTIN_CATALOG.values()
               if stage_of(t) == stage and et in sendable.get(t.key, ())
               and t.category != TemplateCategory.WITH_IMAGE]
    if not options:
        return None
    rec = default_variant_for(et, stage)
    options.sort(key=lambda t: (_variant_of(t.key)[0] != rec, not t.is_default, t.priority, t.key))
    best = options[0].key
    swap = swaps.get(best.split("__", 1)[0])
    if swap and (not swap["event_types"] or et in swap["event_types"]):
        return swap["ref"]
    return best


def ensure_default_rounds(db: Session, event: Event, now: Optional[dt.datetime] = None) -> int:
    """Create the plan's message rounds for an event with a date and no rounds.
    Best-effort per round: one that cannot be created is logged and skipped.
    Returns how many were created."""
    from app.crud import campaign as campaign_crud
    from app.entitlement_service import effective_included_rounds
    from app.schemas.schemas import CampaignCreate

    if event is None or event.event_date is None:
        return 0
    if db.query(Campaign.id).filter(Campaign.event_id == str(event.id)).first() is not None:
        return 0
    now = now or dt.datetime.now(dt.timezone.utc)
    planned = [r for r in message_rounds(event.event_type, event.plan_id, event.event_date, now) if r.enabled]
    planned = planned[:max(0, effective_included_rounds(event))]
    created = 0
    for r in planned:
        template = default_template_for(r.stage, event.event_type, db)
        if not template:
            logger.warning("default rounds: no deliverable %s template for %s (event %s)",
                           r.stage, event.event_type, event.id)
            continue
        try:
            campaign_crud.create_campaign(db, CampaignCreate(
                event_id=event.id, name=r.title, template=template, channel="whatsapp",
                status="pending", schedule_time=r.at))
            created += 1
        except Exception as e:  # noqa: BLE001 - one bad round must not block the rest
            db.rollback()
            logger.warning("default rounds: %s for event %s not created: %s", r.stage, event.id, e)
    if created:
        logger.info("default rounds: created %d round(s) for event %s", created, event.id)
    return created
