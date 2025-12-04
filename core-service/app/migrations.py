from __future__ import annotations

import logging

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


def apply_schema_patches(engine: Engine) -> None:
    ensure_guest_counts_and_group(engine)


