from __future__ import annotations

import json
import logging
import uuid

from sqlalchemy import text
from sqlalchemy.engine import Engine


logger = logging.getLogger(__name__)


def ensure_messaging_template_state(engine: Engine) -> None:
    """Create `messaging_template_state` - the DB home for MUTABLE Meta runtime
    state of built-in catalog templates (the catalog YAML stays pure authored
    content). Idempotent; a key with no row is treated as its catalog default."""
    with engine.begin() as conn:
        try:
            conn.execute(text(
                """
                CREATE TABLE IF NOT EXISTS messaging_template_state (
                    template_key       VARCHAR(80) PRIMARY KEY,
                    internal_status    VARCHAR(30) NOT NULL DEFAULT 'draft',
                    meta_id            VARCHAR(128),
                    meta_status        VARCHAR(20) NOT NULL DEFAULT 'none',
                    meta_category      VARCHAR(30),
                    uploaded_at        TIMESTAMPTZ,
                    last_sync          TIMESTAMPTZ,
                    rejection_reason   TEXT,
                    published_checksum VARCHAR(64),
                    published_version  INTEGER NOT NULL DEFAULT 0,
                    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
                )
                """
            ))
        except Exception as exc:  # pragma: no cover
            logger.debug("messaging_template_state create skipped: %s", exc)


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
        # Optional header image for templates whose header is an image. When set,
        # it overrides the default header_image_url at send time (see worker).
        "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS header_image_url TEXT",
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
        # Paid extra message-round credits (beyond the plan's included rounds).
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS extra_rounds_allowance INTEGER NOT NULL DEFAULT 0",
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


def ensure_events_subjects(engine: Engine) -> None:
    """Ensure events.subjects (JSONB) exists - the event-type-specific subjects
    (bride/groom/parents/baby/celebrant/company). Persisted so subject variables
    resolve identically in preview and delivery."""
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE events ADD COLUMN IF NOT EXISTS subjects JSONB"))
            logger.info("Schema patch applied: events.subjects")
        except Exception as exc:  # pragma: no cover
            logger.debug("events.subjects skipped: %s", exc)


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


def ensure_campaign_template_key(engine: Engine) -> None:
    """Add campaigns.template_key (the canonical catalog id) and backfill it for
    existing rows by resolving their legacy `template` reference through the
    messaging SSOT. This is the messaging-refactor migration path: the raw
    `template` value is preserved (rollback-safe); the worker prefers the
    canonical key when present and still resolves `template` when it is NULL."""
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS template_key VARCHAR(80)"))
        except Exception as exc:  # pragma: no cover
            logger.debug("template_key column skipped: %s", exc)
            return

    # Backfill (best-effort): resolve legacy template -> canonical key. UUID/DB
    # references without a lookup resolve to None and are left for the worker.
    try:
        from shared.domain.messaging import resolve_template
    except Exception as exc:  # pragma: no cover
        logger.warning("messaging SSOT unavailable, skipping template_key backfill: %s", exc)
        return

    with engine.begin() as conn:
        rows = conn.execute(text(
            "SELECT id, template, campaign_type FROM campaigns WHERE template_key IS NULL AND template IS NOT NULL"
        )).mappings().all()
        backfilled = 0
        for r in rows:
            t = resolve_template(r["template"], flow_stage=r.get("campaign_type"))
            if t is not None:
                conn.execute(
                    text("UPDATE campaigns SET template_key = :k WHERE id = :id"),
                    {"k": t.key, "id": r["id"]},
                )
                backfilled += 1
        if rows:
            logger.info("template_key backfill: %d/%d campaigns resolved", backfilled, len(rows))


def ensure_campaign_stage_variant(engine: Engine) -> None:
    """Add campaigns.stage_id / variant_id (the stage-execution coordinates) and
    backfill them from each campaign's template via the stage catalog. Additive and
    rollback-safe: the worker prefers (stage,variant) but resolves the same Template
    the legacy key would, so nothing changes at runtime."""
    with engine.begin() as conn:
        for stmt in (
            "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS stage_id VARCHAR(40)",
            "ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS variant_id VARCHAR(60)",
        ):
            try:
                conn.execute(text(stmt))
            except Exception as exc:  # pragma: no cover
                logger.debug("stage/variant column skipped: %s", exc)
                return

    try:
        from shared.domain.messaging import stage_variant_for_template
    except Exception as exc:  # pragma: no cover
        logger.warning("messaging SSOT unavailable, skipping stage/variant backfill: %s", exc)
        return

    with engine.begin() as conn:
        rows = conn.execute(text(
            "SELECT id, template_key, template FROM campaigns WHERE stage_id IS NULL"
        )).mappings().all()
        n = 0
        for r in rows:
            sv = stage_variant_for_template(r["template_key"] or r["template"])
            if sv:
                conn.execute(
                    text("UPDATE campaigns SET stage_id = :s, variant_id = :v WHERE id = :id"),
                    {"s": sv[0], "v": sv[1], "id": r["id"]},
                )
                n += 1
        if rows:
            logger.info("stage/variant backfill: %d/%d campaigns mapped", n, len(rows))


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


# NOTE: Global templates are defined in the messaging SSOT
# (shared/domain/messaging/catalog.py) and served via GET /catalog. The old DB
# seed of public templates was removed to keep ONE source of truth; the
# wa_templates table now holds only custom, event-scoped templates.


def ensure_accounts_venue_columns(engine: Engine) -> None:
    """Ensure the Venue Edition columns exist on accounts: type, event_capacity,
    partner_coupon_code. The ORM model declares them, so without these every
    Account query fails with UndefinedColumn on pre-existing deployments."""
    statements = [
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS type VARCHAR(20) NOT NULL DEFAULT 'personal'",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS event_capacity INTEGER",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS partner_coupon_code VARCHAR(50)",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
                logger.info("Schema patch applied: %s", stmt)
            except Exception as exc:  # pragma: no cover - best-effort migration
                logger.debug("Schema patch skipped: %s (%s)", stmt, exc)
                continue
    logger.info("Account schema verified (type, event_capacity, partner_coupon_code columns exist)")


def ensure_admin_ops_schema(engine: Engine) -> None:
    """Phase 2 (production ops): account suspend/branding, audit log, feature flags.

    - accounts.status         : 'active' | 'suspended' (venue suspend/reactivate)
    - accounts.branding       : JSONB, future-ready venue branding config
    - audit_log               : append-only record of privileged admin/venue actions
    - feature_flags           : global operational flags toggled from the admin console
    """
    statements = [
        "CREATE EXTENSION IF NOT EXISTS pgcrypto",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS branding JSONB",
        # Matches the existing AuditLog ORM model (models.py) so both agree.
        """
        CREATE TABLE IF NOT EXISTS audit_log (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            account_id UUID,
            actor_type VARCHAR(20) NOT NULL,
            actor_id UUID,
            action VARCHAR(60) NOT NULL,
            entity_type VARCHAR(40),
            entity_id UUID,
            data JSONB,
            occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_audit_log_occurred ON audit_log (occurred_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_audit_log_account ON audit_log (account_id)",
        """
        CREATE TABLE IF NOT EXISTS feature_flags (
            key VARCHAR(80) PRIMARY KEY,
            enabled BOOLEAN NOT NULL DEFAULT false,
            description TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_by UUID
        )
        """,
    ]
    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
                logger.info("Schema patch applied: %s", stmt.strip().split("\n")[0])
            except Exception as exc:  # pragma: no cover - best-effort migration
                logger.debug("Schema patch skipped: %s (%s)", stmt.strip()[:50], exc)
                continue
    logger.info("Admin-ops schema verified (accounts.status/branding, audit_log, feature_flags)")


def apply_schema_patches(engine: Engine) -> None:
    ensure_guest_counts_and_group(engine)
    ensure_campaign_recipient_count(engine)
    ensure_events_location_text(engine)
    ensure_events_plan_id(engine)
    ensure_events_seating_layout(engine)
    ensure_events_v2_columns(engine)
    ensure_events_payment_status(engine)
    ensure_events_event_type(engine)
    ensure_events_subjects(engine)
    ensure_campaign_custom_message(engine)
    ensure_campaign_template_key(engine)
    ensure_campaign_stage_variant(engine)
    ensure_campaign_audience(engine)
    ensure_wa_template_metadata(engine)
    ensure_accounts_venue_columns(engine)
    ensure_admin_ops_schema(engine)
    ensure_messaging_template_state(engine)


