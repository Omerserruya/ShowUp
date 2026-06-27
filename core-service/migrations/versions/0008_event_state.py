"""event lifecycle state (Phase 13)

Revision ID: 0008_event_state
Revises: 0007_wa_templates
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0008_event_state"
down_revision = "0007_wa_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("state", sa.String(20), nullable=False, server_default="active"))
    # Backfill: inactive events are treated as archived.
    op.execute("UPDATE events SET state = 'archived' WHERE active = false")


def downgrade() -> None:
    op.drop_column("events", "state")
