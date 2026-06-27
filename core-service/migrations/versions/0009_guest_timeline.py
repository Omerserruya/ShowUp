"""guest timeline: guest_events (Phase 9)

Revision ID: 0009_guest_timeline
Revises: 0008_event_state
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0009_guest_timeline"
down_revision = "0008_event_state"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "guest_events",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("guest_id", UUID, sa.ForeignKey("guests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_id", UUID, sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(30), nullable=False),
        sa.Column("actor_type", sa.String(20), nullable=False),
        sa.Column("actor_id", UUID, nullable=True),
        sa.Column("data", sa.JSON()),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_guest_events_guest_id", "guest_events", ["guest_id"])
    op.create_index("ix_guest_events_event_id", "guest_events", ["event_id"])


def downgrade() -> None:
    op.drop_index("ix_guest_events_event_id", table_name="guest_events")
    op.drop_index("ix_guest_events_guest_id", table_name="guest_events")
    op.drop_table("guest_events")
