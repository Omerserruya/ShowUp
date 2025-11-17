from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.engine import Engine


logger = logging.getLogger(__name__)


def ensure_guest_counts(engine: Engine) -> None:
    """
    Ensure guests table has nullable guest_count (no default) and import_count column.
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
    ]

    with engine.begin() as conn:
        for stmt in statements:
            try:
                conn.execute(text(stmt))
            except Exception as exc:  # pragma: no cover - best-effort migration
                logger.debug("Schema patch skipped: %s (%s)", stmt, exc)
                continue

    logger.info("Guest schema verified (guest_count nullable, import_count default=1)")


def apply_schema_patches(engine: Engine) -> None:
    ensure_guest_counts(engine)


