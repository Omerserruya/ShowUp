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
            # Enable UUID extension if not already enabled
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\""))
            
            # Create all tables (SQLAlchemy will skip existing ones)
            await conn.run_sync(Base.metadata.create_all)
            
            # Ensure conversations.id has default UUID generation (if table exists but column doesn't have default)
            # This is a safety measure - SQLAlchemy should handle it, but we ensure it's set
            await conn.execute(text("""
                DO $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'conversations') THEN
                        -- Check if default doesn't exist and add it
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'conversations' 
                            AND column_name = 'id' 
                            AND column_default LIKE '%uuid%'
                        ) THEN
                            ALTER TABLE conversations 
                            ALTER COLUMN id SET DEFAULT uuid_generate_v4();
                        END IF;
                    END IF;
                END $$;
            """))
            
            # Ensure new columns exist
            await conn.execute(text("ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS status VARCHAR(32)"))
            logger.info("Database tables initialized successfully")
    except Exception as e:
        logger.error(f"Failed to create database tables: {e}")
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(init_db())

