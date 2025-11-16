"""
Apply database migration for conversations table indexes and constraints.

This script applies the migration defined in 001_add_conversation_indexes.sql
to add performance indexes and enforce uniqueness constraints.

Usage:
    python apply_migration.py
"""

import asyncio
import logging
import os
from pathlib import Path

from sqlalchemy import text
from db.session import engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def apply_migration():
    """Apply the migration to add indexes and constraints."""
    migration_file = Path(__file__).parent / "001_add_conversation_indexes.sql"
    
    if not migration_file.exists():
        logger.error(f"Migration file not found: {migration_file}")
        return
    
    logger.info(f"Reading migration from {migration_file}")
    with open(migration_file, "r") as f:
        migration_sql = f.read()
    
    try:
        async with engine.begin() as conn:
            # Execute the migration SQL
            await conn.execute(text(migration_sql))
            logger.info("Migration applied successfully")
    except Exception as e:
        logger.error(f"Failed to apply migration: {e}")
        raise


if __name__ == "__main__":
    asyncio.run(apply_migration())

