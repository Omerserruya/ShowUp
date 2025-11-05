"""Initialize database tables for webhook-worker."""
import asyncio
import logging

from db.models import Base
from db.session import engine

logger = logging.getLogger(__name__)


async def init_db() -> None:
    """Create all database tables if they don't exist."""
    try:
        async with engine.begin() as conn:
            # Create all tables (SQLAlchemy will skip existing ones)
            await conn.run_sync(Base.metadata.create_all)
            logger.info("Database tables initialized successfully")
    except Exception as e:
        logger.error(f"Failed to create database tables: {e}")
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(init_db())

