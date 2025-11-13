"""Initialize database tables for webhook-worker."""
import asyncio
import logging

from sqlalchemy import text

from db.models import Base
from db.session import engine

logger = logging.getLogger(__name__)


async def init_db() -> None:
    """Create all database tables if they don't exist."""
    try:
        async with engine.begin() as conn:
            # Create all tables (SQLAlchemy will skip existing ones)
            await conn.run_sync(Base.metadata.create_all)
            # Ensure new columns exist
            await conn.execute(text("ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS status VARCHAR(32)"))
            logger.info("Database tables initialized successfully")
    except Exception as e:
        logger.error(f"Failed to create database tables: {e}")
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(init_db())

