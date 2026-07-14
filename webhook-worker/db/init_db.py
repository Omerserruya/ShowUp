"""Initialize database tables for webhook-worker."""
import asyncio
import logging

from sqlalchemy import text

from db.models import Base
from db.session import engine

logger = logging.getLogger(__name__)


async def _create_conversation_indexes(conn):
    """
    Create indexes and constraints for conversations table.
    
    This ensures:
    1. Efficient lookups on (guest_id, event_id, active)
    2. Uniqueness constraint for active conversations per guest+event pair
       (supports multiple inactive conversations but only one active one)
    """
    try:
        # Create index for efficient lookups
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_conversations_guest_event_active
                ON conversations (guest_id, event_id, active)
        """))
        logger.info("Created index: idx_conversations_guest_event_active")
        
        # Create unique partial index to enforce one active conversation per guest+event
        # This allows multiple inactive conversations but only one active one
        await conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_conversation_per_guest_event
                ON conversations (guest_id, event_id)
                WHERE active = TRUE
        """))
        logger.info("Created unique index: uniq_active_conversation_per_guest_event")
        
    except Exception as e:
        logger.warning(f"Failed to create conversation indexes (they may already exist): {e}")


async def init_db() -> None:
    """Create all database tables if they don't exist and apply migrations."""
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
            await conn.execute(text("ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS guest_phone VARCHAR(64)"))
            await conn.execute(text("ALTER TABLE messages_log ADD COLUMN IF NOT EXISTS campaign_id uuid"))
            
            # Create index on guest_phone + direction for efficient free-text resolution queries
            await conn.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_messages_log_guest_phone_direction_created
                    ON messages_log (guest_phone, direction, created_at DESC)
                    WHERE guest_phone IS NOT NULL
            """))
            
            # Create indexes and constraints for conversations table
            await _create_conversation_indexes(conn)
            
            # Normalize existing phone numbers in conversations and messages_log
            # This migration removes leading "+" and "00" prefixes to match WhatsApp format
            logger.info("Normalizing existing phone numbers in conversations and messages_log...")
            try:
                # Normalize conversations.guest_phone
                # Remove leading "+" and "00" prefixes, keep only digits
                await conn.execute(text("""
                    UPDATE conversations
                    SET guest_phone = REGEXP_REPLACE(
                        REGEXP_REPLACE(guest_phone, '^\\+', ''),
                        '^00', ''
                    )
                    WHERE guest_phone IS NOT NULL
                      AND (guest_phone LIKE '+%' OR guest_phone LIKE '00%');
                """))
                logger.info("Normalized phone numbers in conversations table")
                
                # Normalize messages_log.guest_phone
                await conn.execute(text("""
                    UPDATE messages_log
                    SET guest_phone = REGEXP_REPLACE(
                        REGEXP_REPLACE(guest_phone, '^\\+', ''),
                        '^00', ''
                    )
                    WHERE guest_phone IS NOT NULL
                      AND (guest_phone LIKE '+%' OR guest_phone LIKE '00%');
                """))
                logger.info("Normalized phone numbers in messages_log table")
            except Exception as e:
                logger.warning(f"Failed to normalize existing phone numbers (they may already be normalized): {e}")
            
            logger.info("Database tables initialized and migrations applied successfully")
    except Exception as e:
        logger.error(f"Failed to create database tables: {e}")
        raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(init_db())

