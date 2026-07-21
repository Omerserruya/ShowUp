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


def ensure_events_provisioning(engine: Engine) -> None:
    """Payment-as-source-of-truth schema (production hardening, 2026-07).

    Adds `events.provisioning_order_id` plus the UNIQUE index that makes
    provisioning idempotent: two concurrent IPN deliveries for one order cannot
    create two events, because the second INSERT violates this constraint rather
    than relying on the caller to lock correctly.

    Then backfills settlement for pre-existing rows. `payment_status` used to
    default to 'unpaid' and was written only sporadically, so enforcing on it
    without a backfill would deactivate every legacy event. The rule
    grandfathers them: an event on a free-of-charge plan becomes 'free',
    anything else is assumed 'paid' (it is already live in production). Only
    rows still carrying the legacy 'unpaid' default are touched, so this is
    safe to re-run and never downgrades a row the provisioning path has since
    written.
    """
    statements = [
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS provisioning_order_id VARCHAR(64)",
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS last_plan_order_id VARCHAR(64)",
        "CREATE INDEX IF NOT EXISTS ix_events_last_plan_order_id ON events (last_plan_order_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_events_provisioning_order_id "
        "ON events (provisioning_order_id) WHERE provisioning_order_id IS NOT NULL",
        # Name the implicit unmetered exemption. Events predating billing carry
        # plan_id NULL, which the old code treated as unmetered by accident;
        # `included_rounds` now fails closed on an unknown/absent plan, so these
        # rows are moved onto the explicit `legacy` plan to preserve their
        # existing (unmetered) behaviour instead of suddenly blocking their sends.
        "UPDATE events SET plan_id = 'legacy' WHERE plan_id IS NULL",
        # Grandfather legacy rows: free-of-charge plans -> 'free'.
        "UPDATE events SET payment_status = 'free' "
        "WHERE payment_status = 'unpaid' "
        "AND (plan_id IS NULL OR lower(plan_id) IN ('free', 'starter', 'venue'))",
        # ...everything else is an existing paid customer -> 'paid'.
        "UPDATE events SET payment_status = 'paid' WHERE payment_status = 'unpaid'",
        # `active` is now derived from (state, payment_status). Re-derive it once
        # so the column agrees with the invariant from here on.
        "UPDATE events SET active = (state IN ('draft', 'active') "
        "AND payment_status IN ('paid', 'free'))",
    ]
    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
                logger.info("Schema patch applied: %s", stmt.split("\n")[0])
            except Exception as exc:  # pragma: no cover - best-effort migration
                logger.debug("Schema patch skipped: %s (%s)", stmt, exc)
                continue
    logger.info("Event provisioning schema verified (order id + settlement backfill)")


def ensure_guest_optout(engine: Engine) -> None:
    """Guest opt-out columns (STOP/UNSUBSCRIBE suppression).

    DDL is owned by `shared.domain.optout` so core, campaign-worker and
    webhook-worker all agree on the shape. All columns are nullable, so every
    existing guest stays subscribed - nobody is retroactively suppressed.
    """
    from shared.domain.optout import ENSURE_GUEST_OPTOUT_DDL
    with engine.begin() as conn:
        for stmt in ENSURE_GUEST_OPTOUT_DDL:
            try:
                conn.execute(text(stmt))
                logger.info("Schema patch applied: %s", stmt)
            except Exception as exc:  # pragma: no cover
                logger.debug("guest opt-out patch skipped: %s (%s)", stmt, exc)
    logger.info("Guest opt-out schema verified")


def ensure_message_delivery(engine: Engine) -> None:
    """Per-message delivery state on `messages_sent`.

    Owned by `shared.domain.delivery`. The workers create this table themselves,
    but core reads it for campaign statistics, so it ensures the shape too rather
    than depending on which service happened to boot first.
    """
    from shared.domain.delivery import ENSURE_MESSAGES_SENT_DDL
    with engine.begin() as conn:
        for stmt in ENSURE_MESSAGES_SENT_DDL:
            try:
                conn.execute(text(stmt))
            except Exception as exc:  # pragma: no cover
                logger.debug("message delivery patch skipped: %s", exc)
    logger.info("Message delivery schema verified")


def ensure_ops_tables(engine: Engine) -> None:
    """Operations-dashboard tables: service heartbeats + captured errors.

    The `shared.ops` helpers self-create these on first write, but core ensures
    them here (with indexes) so the ops API can read them before any worker has
    beaten, and so the indexes exist regardless of which service wrote first.
    """
    from shared.ops.heartbeat import _DDL as HEARTBEAT_DDL
    from shared.ops.errors import _DDL as ERRORS_DDL
    with engine.begin() as conn:
        try:
            conn.execute(text(HEARTBEAT_DDL))
        except Exception as exc:  # pragma: no cover
            logger.debug("service_heartbeats ensure skipped: %s", exc)
        for stmt in ERRORS_DDL:
            try:
                conn.execute(text(stmt))
            except Exception as exc:  # pragma: no cover
                logger.debug("ops_errors ensure skipped: %s", exc)
    logger.info("Ops tables verified (service_heartbeats, ops_errors)")


def ensure_entitlements(engine: Engine) -> None:
    """Entitlement system: the single record of WHY an event may be created.

    The `entitlements` table itself is created by `Base.metadata.create_all`
    (it is a new model). This patch adds the columns that link an EXISTING
    `events` table to it, and backfills a synthetic entitlement for every event
    that predates the system - so the invariant "every event consumes exactly
    one entitlement" holds retroactively, not just for new events.

    The backfill classifies each legacy event by its settlement: a paid event
    gets a `payment` entitlement, everything else a `system` one. All are
    `redeemed`, linked both ways, and idempotent (only events with no
    entitlement yet are touched), so this is safe to re-run.
    """
    statements = [
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS entitlement_id UUID",
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS max_guests_override INTEGER",
        "ALTER TABLE events ADD COLUMN IF NOT EXISTS included_rounds_override INTEGER",
        # The FK + uniqueness that make "one event per entitlement" a database
        # guarantee. Added defensively (IF NOT EXISTS via DO block) so a re-run
        # or a create_all that already added them does not error.
        """
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_events_entitlement_id') THEN
                ALTER TABLE events ADD CONSTRAINT fk_events_entitlement_id
                    FOREIGN KEY (entitlement_id) REFERENCES entitlements(id) ON DELETE RESTRICT;
            END IF;
        END $$;
        """,
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_events_entitlement_id ON events (entitlement_id) "
        "WHERE entitlement_id IS NOT NULL",
        # Backfill: mint one redeemed entitlement per un-linked event and link it.
        """
        WITH ins AS (
            INSERT INTO entitlements
                (id, code, status, source, plan_id, redeemed_at,
                 redeemed_by_user_id, redeemed_event_id, order_id, created_at, updated_at)
            SELECT gen_random_uuid(),
                   'legacy-' || replace(gen_random_uuid()::text, '-', ''),
                   'redeemed',
                   CASE WHEN e.payment_status = 'paid' THEN 'payment' ELSE 'system' END,
                   COALESCE(e.plan_id, 'legacy'),
                   COALESCE(e.created_at, NOW()),
                   NULLIF(e.owners->>0, '')::uuid,
                   e.id,
                   e.provisioning_order_id,
                   NOW(), NOW()
            FROM events e
            WHERE e.entitlement_id IS NULL
            RETURNING id, redeemed_event_id
        )
        UPDATE events SET entitlement_id = ins.id
        FROM ins WHERE events.id = ins.redeemed_event_id;
        """,
    ]
    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
                logger.info("Schema patch applied: %s", stmt.strip().split("\n")[0])
            except Exception as exc:  # pragma: no cover - best-effort migration
                logger.debug("entitlements patch skipped: %s (%s)", stmt.strip()[:60], exc)
    logger.info("Entitlement schema verified (table + event link + backfill)")


def ensure_round_usage_backfill(engine: Engine) -> None:
    """Seed the round-usage ledger from existing campaigns.

    Round entitlement now counts consumption from the append-only `usage_events`
    ledger instead of `COUNT(campaigns)` (which was refundable by deleting a
    campaign). Events created before the ledger existed have campaigns but few
    or no ROUND_LAUNCHED rows, so without this backfill they would read as
    "0 rounds used" and be handed their whole allowance a second time.

    Inserts only the DIFFERENCE per event, so it is safe to re-run: once the
    ledger matches the campaign count the gap is zero and nothing is written.
    """
    stmt = """
        INSERT INTO usage_events (id, account_id, event_id, metric, quantity, occurred_at)
        SELECT gen_random_uuid(), e.account_id, e.id, 'round_launched',
               c.campaign_count - COALESCE(u.ledger_total, 0), NOW()
        FROM events e
        JOIN (
            SELECT event_id::uuid AS event_id, COUNT(*) AS campaign_count
            FROM campaigns GROUP BY event_id
        ) c ON c.event_id = e.id
        LEFT JOIN (
            SELECT event_id, SUM(quantity) AS ledger_total
            FROM usage_events WHERE metric = 'round_launched' GROUP BY event_id
        ) u ON u.event_id = e.id
        WHERE c.campaign_count > COALESCE(u.ledger_total, 0)
    """
    with engine.begin() as conn:
        try:
            result = conn.execute(text(stmt))
            logger.info("Round usage ledger backfilled for %s event(s)", result.rowcount)
        except Exception as exc:  # pragma: no cover - best-effort migration
            logger.debug("round usage backfill skipped: %s", exc)


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


def ensure_events_wa_image(engine: Engine) -> None:
    """events.wa_image_url - the event's WhatsApp COVER image. Uploaded during
    onboarding (or replaced any time in settings) and used as the default header
    image for every image-header WhatsApp template (save-the-date, invitation);
    a per-campaign header_image_url still overrides it."""
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE events ADD COLUMN IF NOT EXISTS wa_image_url TEXT"))
        except Exception as exc:  # pragma: no cover
            logger.debug("events.wa_image_url add skipped: %s", exc)


def ensure_team_invitations(engine: Engine) -> None:
    """Pending team invitations by phone. Unlike memberships, the invitee may
    not have a user account yet - the invitation is claimed (converted to an
    active Membership) on their first sign-in, keyed by canonical E.164 phone."""
    with engine.begin() as conn:
        try:
            conn.execute(text(
                """
                CREATE TABLE IF NOT EXISTS team_invitations (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    account_id UUID NOT NULL,
                    event_id UUID,
                    phone VARCHAR(32) NOT NULL,
                    role VARCHAR(30) NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    invited_by UUID,
                    user_id UUID,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    accepted_at TIMESTAMPTZ,
                    UNIQUE (account_id, phone)
                )
                """
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_team_invitations_phone ON team_invitations (phone) WHERE status = 'pending'"
            ))
        except Exception as exc:  # pragma: no cover
            logger.debug("team_invitations create skipped: %s", exc)


def ensure_owner_notifications(engine: Engine) -> None:
    """Owner-notification OUTBOX. Writers (core, aub) insert rows; the
    scheduler-service dispatcher publishes them to WhatsApp via outpost and
    marks them sent. Template contract: shared/content/system_templates.yaml."""
    with engine.begin() as conn:
        try:
            conn.execute(text(
                """
                CREATE TABLE IF NOT EXISTS owner_notifications (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    kind VARCHAR(40) NOT NULL,
                    recipient_phone VARCHAR(32) NOT NULL,
                    event_id UUID,
                    params JSONB NOT NULL DEFAULT '{}',
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    attempts INTEGER NOT NULL DEFAULT 0,
                    dedupe_key VARCHAR(160) UNIQUE,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    sent_at TIMESTAMPTZ
                )
                """
            ))
            conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_owner_notifications_pending ON owner_notifications (created_at) WHERE status = 'pending'"
            ))
        except Exception as exc:  # pragma: no cover
            logger.debug("owner_notifications create skipped: %s", exc)


def apply_schema_patches(engine: Engine) -> None:
    """Apply every schema patch, isolating failures.

    Each patch runs independently: one that raises is logged and the rest still
    run. Previously a single failing patch aborted the whole chain, so every
    LATER patch was silently skipped - and on a virgin database
    `ensure_campaign_template_key` does raise (it selects `campaigns.campaign_type`,
    which `create_all` never creates). That turned one legacy bug into "the
    opt-out and delivery-tracking columns were never created", failing at runtime
    far from the cause. Ordering still matters for dependencies, so the sequence
    is unchanged - only the isolation is new.
    """
    patches = (
        ensure_guest_counts_and_group,
        ensure_campaign_recipient_count,
        ensure_events_location_text,
        ensure_events_plan_id,
        ensure_events_seating_layout,
        ensure_events_v2_columns,
        ensure_events_payment_status,
        ensure_events_provisioning,
        ensure_events_event_type,
        ensure_events_subjects,
        ensure_campaign_custom_message,
        ensure_campaign_template_key,
        ensure_campaign_stage_variant,
        ensure_campaign_audience,
        ensure_wa_template_metadata,
        ensure_accounts_venue_columns,
        ensure_admin_ops_schema,
        ensure_messaging_template_state,
        ensure_events_wa_image,
        ensure_team_invitations,
        ensure_owner_notifications,
        ensure_guest_optout,
        ensure_message_delivery,
        ensure_ops_tables,
        # Must run AFTER the events table exists (adds the event->entitlement link).
        ensure_entitlements,
        # Must run AFTER the campaigns/usage tables exist.
        ensure_round_usage_backfill,
    )
    failed = []
    for patch in patches:
        try:
            patch(engine)
        except Exception as exc:
            failed.append(patch.__name__)
            logger.error("Schema patch %s FAILED: %s", patch.__name__, exc)
    if failed:
        logger.error(
            "%s schema patch(es) failed and were skipped: %s. The service will run, "
            "but features depending on those columns may misbehave.",
            len(failed), ", ".join(failed),
        )


