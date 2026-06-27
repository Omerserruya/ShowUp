"""usage ledger: usage_events (Phase 10)

Revision ID: 0010_usage_events
Revises: 0009_guest_timeline
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0010_usage_events"
down_revision = "0009_guest_timeline"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "usage_events",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("account_id", UUID, sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True),
        sa.Column("event_id", UUID, sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=True),
        sa.Column("metric", sa.String(30), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("ref_id", UUID, nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_usage_events_account_id", "usage_events", ["account_id"])
    op.create_index("ix_usage_events_event_id", "usage_events", ["event_id"])
    op.create_index("ix_usage_events_metric", "usage_events", ["account_id", "metric"])


def downgrade() -> None:
    op.drop_index("ix_usage_events_metric", table_name="usage_events")
    op.drop_index("ix_usage_events_event_id", table_name="usage_events")
    op.drop_index("ix_usage_events_account_id", table_name="usage_events")
    op.drop_table("usage_events")
