"""Initialize database tables for webhook-worker."""
import asyncio
import logging
from pathlib import Path

from sqlalchemy import text

from db.models import Base
from db.session import engine

logger = logging.getLogger(__name__)


async def _apply_migrations(conn):
    """Apply database migrations."""
    migrations_dir = Path(__file__).parent / "migrations"
    
    if not migrations_dir.exists():
        logger.warning(f"Migrations directory not found: {migrations_dir}")
        return
    
    # Apply migrations in order
    migration_files = sorted(migrations_dir.glob("*.sql"))
    
    for migration_file in migration_files:
        logger.info(f"Applying migration: {migration_file.name}")
        with open(migration_file, "r") as f:
            migration_sql = f.read()
        await conn.execute(text(migration_sql))
        logger.info(f"Applied migration: {migration_file.name}")


async def init_db() -> None:
    """Create all database tables if they don't exist and apply migrations."""
    try:
        async with engine.begin() as conn:
            # Create all tables (SQLAlchemy will skip existing ones)
            await conn.run_sync(Base.metadata.create_all)
            # Ensure new columns exist
            await conn.execute(text("ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS status VARCHAR(32)"))
            
            # Apply migrations
            await _apply_migrations(conn)
            
            logger.info("Database tables initialized and migrations applied successfully")
    except Exception as e:
        logger.error(f"Failed to create database tables: {e}")
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(init_db())

