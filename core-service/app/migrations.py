from __future__ import annotations

import json
import logging
import uuid

from sqlalchemy import text
from sqlalchemy.engine import Engine


logger = logging.getLogger(__name__)


def ensure_guest_counts_and_group(engine: Engine) -> None:
    """
    Ensure guests table schema matches application expectations:
    - guest_count: nullable, no default
    - import_count: exists, NOT NULL, default 1
    - guest_group: optional text column for guest grouping (e.g. bride/groom side)

    Applied opportunistically on startup so deployments stay in sync without manual SQL.
    """
    statements = [
        # guest_count should be nullable with no default
        "ALTER TABLE guests ALTER COLUMN guest_count DROP DEFAULT",
        "ALTER TABLE guests ALTER COLUMN guest_count DROP NOT NULL",
        # make sure import_count exists and stays in sync
        "ALTER TABLE guests ADD COLUMN IF NOT EXISTS import_count INTEGER",
        "UPDATE guests SET import_count = 1 WHERE import_count IS NULL",
        "ALTER TABLE guests ALTER COLUMN import_count SET DEFAULT 1",
        "ALTER TABLE guests ALTER COLUMN import_count SET NOT NULL",
        # ensure guest_group column exists (avoid reserved word 'group')
        "ALTER TABLE guests ADD COLUMN IF NOT EXISTS guest_group VARCHAR(100)",
    ]

    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
            except Exception as exc:  # pragma: no cover - best-effort migration
                logger.debug("Schema patch skipped: %s (%s)", stmt, exc)
                continue

    logger.info("Guest schema verified (guest_count nullable, import_count default=1, guest_group column exists)")


def ensure_campaign_recipient_count(engine: Engine) -> None:
    """
    Ensure campaigns table has recipient_count column to track actual recipients per campaign.
    """
    statements = [
        "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS recipient_count INTEGER",
        "UPDATE campaigns SET recipient_count = 0 WHERE recipient_count IS NULL",
        "ALTER TABLE campaigns ALTER COLUMN recipient_count SET DEFAULT 0",
        "ALTER TABLE campaigns ALTER COLUMN recipient_count SET NOT NULL",
    ]

    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
            except Exception as exc:  # pragma: no cover - best-effort migration
                logger.debug("Schema patch skipped: %s (%s)", stmt, exc)
                continue

    logger.info("Campaign schema verified (recipient_count column exists with default 0)")


def ensure_events_location_text(engine: Engine) -> None:
    """
    Ensure events.location can store full JSON strings (TEXT instead of VARCHAR(200)).
    Safe widening migration.
    """
    statements = [
        # First check if column exists, if not add it
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS location TEXT",
        # Then ensure it's TEXT type (not VARCHAR)
        "ALTER TABLE events ALTER COLUMN location TYPE TEXT USING location::text",
    ]

    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
                logger.info(f"Schema patch applied: {stmt}")
            except Exception as exc:  # pragma: no cover - best-effort migration
                logger.debug("Schema patch skipped: %s (%s)", stmt, exc)
                continue

    logger.info("Event schema verified (location column is TEXT)")


def ensure_events_plan_id(engine: Engine) -> None:
    """
    Ensure events.plan_id column exists for plan-based capacity limits.
    """
    statements = [
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS plan_id VARCHAR(50)",
    ]

    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
                logger.info(f"Schema patch applied: {stmt}")
            except Exception as exc:  # pragma: no cover - best-effort migration
                logger.debug("Schema patch skipped: %s (%s)", stmt, exc)
                continue

    logger.info("Event schema verified (plan_id column exists)")


def ensure_events_seating_layout(engine: Engine) -> None:
    """Ensure events.seating_layout JSON column exists for seating map."""
    statements = [
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS seating_layout JSONB",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
                logger.info("Schema patch applied: %s", stmt)
            except Exception as exc:  # pragma: no cover
                logger.debug("Schema patch skipped: %s (%s)", stmt, exc)
    logger.info("Event schema verified (seating_layout column exists)")


def ensure_events_v2_columns(engine: Engine) -> None:
    """
    Ensure the V2 lifecycle / tenancy / public-invitation columns exist on the
    events table. These were added to the model (Phases 13–16) but pre-existing
    deployments only had columns through plan_id/seating_layout, so every Event
    query failed with "column events.state does not exist" until backfilled.
    """
    statements = [
        # Phase 13 lifecycle state (kept in sync with the legacy `active` flag).
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS state VARCHAR(20) NOT NULL DEFAULT 'active'",
        # Phase 13 tenancy: nullable FK to accounts (legacy events backfilled later).
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS account_id UUID",
        "CREATE INDEX IF NOT EXISTS ix_events_account_id ON events (account_id)",
        # Phase 16 public web invitation.
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS public_slug VARCHAR(120)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_events_public_slug ON events (public_slug)",
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS invitation JSONB",
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS invitation_published BOOLEAN NOT NULL DEFAULT false",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
                logger.info("Schema patch applied: %s", stmt)
            except Exception as exc:  # pragma: no cover - best-effort migration
                logger.debug("Schema patch skipped: %s (%s)", stmt, exc)
                continue

    # Add the accounts FK separately - there's no ADD CONSTRAINT IF NOT EXISTS,
    # so guard on the constraint not already existing.
    fk_stmt = (
        "ALTER TABLE events ADD CONSTRAINT fk_events_account_id "
        "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE"
    )
    with engine.begin() as conn:
        try:
            exists = conn.execute(
                text("SELECT 1 FROM pg_constraint WHERE conname = 'fk_events_account_id'")
            ).first()
            if not exists:
                conn.execute(text(fk_stmt))
                logger.info("Schema patch applied: %s", fk_stmt)
        except Exception as exc:  # pragma: no cover - best-effort migration
            logger.debug("Schema patch skipped: %s (%s)", fk_stmt, exc)

    logger.info("Event schema verified (state, account_id, public_slug, invitation columns exist)")


def ensure_events_payment_status(engine: Engine) -> None:
    """
    Ensure events.payment_status exists. Tracks the payment dimension
    ('paid' | 'free' | 'pending' | 'unpaid') independently of lifecycle `state`,
    so the dashboard can show a persistent paid/active status that survives
    refreshes. Set by the payment provisioning path and free-plan creation.
    """
    statements = [
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'unpaid'",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
                logger.info("Schema patch applied: %s", stmt)
            except Exception as exc:  # pragma: no cover - best-effort migration
                logger.debug("Schema patch skipped: %s (%s)", stmt, exc)
                continue
    logger.info("Event schema verified (payment_status column exists)")


def ensure_events_event_type(engine: Engine) -> None:
    """Ensure events.event_type exists. Drives the adaptive timeline + template
    recommendations (wedding, brit, brita, bar, bat, corporate, birthday, other)."""
    statements = [
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS event_type VARCHAR(50)",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
                logger.info("Schema patch applied: %s", stmt)
            except Exception as exc:  # pragma: no cover - best-effort migration
                logger.debug("Schema patch skipped: %s (%s)", stmt, exc)
                continue


def ensure_campaign_custom_message(engine: Engine) -> None:
    """Ensure campaigns.custom_message exists. Persists the user's overriding body
    so custom copy survives order provisioning -> sending."""
    statements = [
        "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS custom_message TEXT",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
                logger.info("Schema patch applied: %s", stmt)
            except Exception as exc:  # pragma: no cover - best-effort migration
                logger.debug("Schema patch skipped: %s (%s)", stmt, exc)
                continue


def ensure_campaign_audience(engine: Engine) -> None:
    """Ensure the Phase 6 V2 audience / follow-up columns exist on campaigns.
    The ORM model declares them, so without these every campaigns query fails with
    UndefinedColumn (HTTP 500) - which is why order provisioning couldn't create
    the default reminder campaigns."""
    statements = [
        "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS audience VARCHAR(20) NOT NULL DEFAULT 'everyone'",
        "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS audience_filter JSON",
        "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS follow_up_after_hours INTEGER",
        "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS follow_up_audience VARCHAR(20)",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
                logger.info("Schema patch applied: %s", stmt)
            except Exception as exc:  # pragma: no cover - best-effort migration
                logger.debug("Schema patch skipped: %s (%s)", stmt, exc)
                continue


def ensure_wa_template_metadata(engine: Engine) -> None:
    """Ensure wa_templates carries the scalable-selection metadata (Phase 17):
    flow_stage, visibility, event_type, expires_at, created_by."""
    statements = [
        "ALTER TABLE wa_templates ADD COLUMN IF NOT EXISTS flow_stage VARCHAR(30)",
        "ALTER TABLE wa_templates ADD COLUMN IF NOT EXISTS visibility VARCHAR(10) NOT NULL DEFAULT 'public'",
        "ALTER TABLE wa_templates ADD COLUMN IF NOT EXISTS event_type VARCHAR(50)",
        "ALTER TABLE wa_templates ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ",
        "ALTER TABLE wa_templates ADD COLUMN IF NOT EXISTS created_by UUID",
        "CREATE INDEX IF NOT EXISTS ix_wa_templates_flow_stage ON wa_templates (flow_stage)",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
                logger.info("Schema patch applied: %s", stmt)
            except Exception as exc:  # pragma: no cover - best-effort migration
                logger.debug("Schema patch skipped: %s (%s)", stmt, exc)
                continue


# Built-in PUBLIC templates. Seeded once so the wizard can fetch+filter templates
# by metadata instead of hardcoding them. Adding a public template later is just a
# new row here (or via API) - no frontend change required. Mirrors the frontend
# seed in frontend/src/config/templates.ts.
_PUBLIC_TEMPLATE_SEED = [
    {
        "name": "תבנית שמור תאריך עם כפתורים", "flow_stage": "invitation", "is_default": True,
        "title": "שמור את התאריך! 📅",
        "body": "שלום {{שם}},\n\nאנחנו שמחים להזמין אותך ל{{סוג_אירוע}} של {{שם_מזמין}}.\n\n📅 תאריך: {{תאריך}}\n🕐 שעה: {{שעה}}\n📍 מיקום: {{מיקום}}\n\nנשמח לראותך!",
        "buttons": [{"id": "view_details", "text": "צפה בפרטים", "type": "url"}, {"id": "confirm", "text": "אשר הגעה", "type": "quick_reply"}],
    },
    {
        "name": "תבנית שמור תאריך פשוטה", "flow_stage": "invitation", "is_default": False,
        "title": "{{שם_אירוע}}",
        "body": "שלום {{שם}},\n\n{{שם_מזמין}} מזמינים אותך ל{{סוג_אירוע}}.\n\n{{תאריך}} בשעה {{שעה}}\n{{מיקום}}\n\nנשמח לראותך!",
        "buttons": None,
    },
    {
        "name": "תזכורת שבוע לפני - מפורטת", "flow_stage": "reminder", "is_default": True,
        "title": "תזכורת: {{שם_אירוע}}",
        "body": "שלום {{שם}},\n\nזו תזכורת ש{{סוג_אירוע}} של {{שם_מזמין}} יתקיים בעוד שבוע.\n\n📅 {{תאריך}} בשעה {{שעה}}\n📍 {{מיקום}}\n\nמצפים לראותך!",
        "buttons": None,
    },
    {
        "name": "תזכורת שבוע לפני - עם כפתור", "flow_stage": "reminder", "is_default": False,
        "title": "תזכורת שבוע לפני",
        "body": "שלום {{שם}},\n\n{{שם_אירוע}} מתקרב! האירוע יתקיים ב{{תאריך}} בשעה {{שעה}} ב{{מיקום}}.\n\nנשמח לראותך שם!",
        "buttons": [{"id": "view_location", "text": "צפה במיקום", "type": "url"}],
    },
    {
        "name": "תזכורת יום לפני - מפורטת", "flow_stage": "final_reminder", "is_default": True,
        "title": "מחר: {{שם_אירוע}}",
        "body": "שלום {{שם}},\n\nתזכורת אחרונה: מחר {{תאריך}} בשעה {{שעה}} יתקיים {{סוג_אירוע}} של {{שם_מזמין}} ב{{מיקום}}.\n\nמצפים לראותך!",
        "buttons": None,
    },
    {
        "name": "תזכורת יום לפני - עם כפתורים", "flow_stage": "final_reminder", "is_default": False,
        "title": "תזכורת: מחר האירוע!",
        "body": "שלום {{שם}},\n\n{{שם_אירוע}} מחר ב{{תאריך}} בשעה {{שעה}}.\nמיקום: {{מיקום}}\n\nלא לשכוח! 😊",
        "buttons": [{"id": "confirm", "text": "אשר הגעה", "type": "quick_reply"}, {"id": "cancel", "text": "לא אוכל להגיע", "type": "quick_reply"}],
    },
    {
        "name": "תודה מפורטת", "flow_stage": "thank_you", "is_default": True,
        "title": "תודה שהגעת! 🙏",
        "body": "שלום {{שם}},\n\nתודה רבה שהגעת ל{{סוג_אירוע}} של {{שם_מזמין}}.\n\nהנוכחות שלך הייתה משמעותית עבורנו ואנחנו מעריכים את זה מאוד.\n\nתודה רבה!",
        "buttons": None,
    },
    {
        "name": "תודה קצרה", "flow_stage": "thank_you", "is_default": False,
        "title": "תודה!",
        "body": "שלום {{שם}},\n\nתודה שהגעת ל{{שם_אירוע}}.\n\nשמחנו לראותך ואנחנו מעריכים את הנוכחות שלך.\n\nתודה רבה!",
        "buttons": None,
    },
]


def seed_public_templates(engine: Engine) -> None:
    """Insert the built-in public templates once (idempotent). Only seeds when no
    global public templates exist yet, so it never duplicates or fights edits."""
    try:
        with engine.begin() as conn:
            existing = conn.execute(
                text("SELECT COUNT(*) FROM wa_templates WHERE event_id IS NULL AND visibility = 'public'")
            ).scalar()
            if existing and int(existing) > 0:
                logger.info("Public templates already present (%s) - skipping seed", existing)
                return
            for t in _PUBLIC_TEMPLATE_SEED:
                components = {"title": t["title"], "is_default": t["is_default"]}
                if t.get("buttons"):
                    components["buttons"] = t["buttons"]
                conn.execute(
                    text(
                        "INSERT INTO wa_templates (id, name, language, body, components, lifecycle, flow_stage, visibility) "
                        "VALUES (:id, :name, 'he', :body, CAST(:components AS json), 'approved', :flow_stage, 'public')"
                    ),
                    {
                        "id": uuid.uuid4(),
                        "name": t["name"],
                        "body": t["body"],
                        "components": json.dumps(components, ensure_ascii=False),
                        "flow_stage": t["flow_stage"],
                    },
                )
            logger.info("Seeded %d public templates", len(_PUBLIC_TEMPLATE_SEED))
    except Exception as exc:  # pragma: no cover - best-effort seed
        logger.debug("Public template seed skipped: %s", exc)


def apply_schema_patches(engine: Engine) -> None:
    ensure_guest_counts_and_group(engine)
    ensure_campaign_recipient_count(engine)
    ensure_events_location_text(engine)
    ensure_events_plan_id(engine)
    ensure_events_seating_layout(engine)
    ensure_events_v2_columns(engine)
    ensure_events_payment_status(engine)
    ensure_events_event_type(engine)
    ensure_campaign_custom_message(engine)
    ensure_campaign_audience(engine)
    ensure_wa_template_metadata(engine)
    seed_public_templates(engine)


