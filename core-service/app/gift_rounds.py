"""Keep the day-before reminder in step with the hosts' gift details.

The event reminder (stage final_reminder) has two approved versions: the plain
one (navigation button) and `reminder_gift_v1` (navigation + gift button, which
opens /g/{code}). Hosts never pick between them: once they save a gift link or
Bit number, every not-yet-sent reminder that still uses the stock template moves
to the gift version; when they clear the details it moves back, so a gift
button never goes out empty.

A reminder the host deliberately set to another template is left alone - only
the stock template (and the gift version itself) are switched.
"""
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import Campaign, Event

logger = logging.getLogger(__name__)

GIFT_REMINDER = "custom__reminder_gift_v1"
_STAGE = "final_reminder"
_OPEN = ("pending", "paused", "draft")


def _plain_reminder(db: Session, event: Event) -> str:
    from app.default_rounds import default_template_for
    return default_template_for(_STAGE, event.event_type, db) or "event_remind"


def sync_gift_reminders(db: Session, event: Event) -> int:
    """Switch the event's open reminder rounds to/from the gift version.
    Returns how many rounds changed. Best-effort per round."""
    from shared.domain.gift import gift_ready
    from app.crud import campaign as campaign_crud
    from app.schemas.schemas import CampaignUpdate

    if event is None:
        return 0
    ready = gift_ready(getattr(event, "gift", None))
    plain = _plain_reminder(db, event)
    stock = {plain, "event_remind"}
    target: Optional[str]
    changed = 0
    rows = (db.query(Campaign)
            .filter(Campaign.event_id == str(event.id), Campaign.status.in_(_OPEN))
            .all())
    for c in rows:
        if campaign_crud.campaign_stage(db, c.template) != _STAGE:
            continue
        if ready and c.template in stock:
            target = GIFT_REMINDER
        elif not ready and c.template == GIFT_REMINDER:
            target = plain
        else:
            continue
        try:
            campaign_crud.update_campaign(db, c, CampaignUpdate(template=target))
            changed += 1
        except Exception as e:  # noqa: BLE001 - one round must not block the rest
            db.rollback()
            logger.warning("gift reminder sync: campaign %s not switched to %s: %s", c.id, target, e)
    if changed:
        logger.info("gift reminder sync: %d round(s) of event %s -> %s", changed, event.id,
                    "gift" if ready else "plain")
    return changed
