-- Migration: Add indexes and constraints for conversations table
-- Purpose: Optimize lookups and enforce uniqueness for active conversations per guest+event
-- 
-- This migration adds:
-- 1. An index on (guest_id, event_id, active) for efficient lookups
-- 2. A unique constraint on (guest_id, event_id) where active = TRUE
--    to prevent duplicate active conversations for the same guest+event pair
--
-- Note: The unique constraint uses a partial index to only enforce uniqueness
-- for active conversations, allowing multiple inactive conversations per guest+event.

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_conversations_guest_event_active
    ON conversations (guest_id, event_id, active);

-- Create unique partial index to enforce one active conversation per guest+event
-- This allows multiple inactive conversations but only one active one
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_conversation_per_guest_event
    ON conversations (guest_id, event_id)
    WHERE active = TRUE;

