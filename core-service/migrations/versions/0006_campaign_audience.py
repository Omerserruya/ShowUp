"""campaign audience + optional follow-up (Phase 6)

Adds first-class audience targeting (decoupled from template) and a single
optional follow-up. No sequence/automation engine.

Revision ID: 0006_campaign_audience
Revises: 0005_tags
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0006_campaign_audience"
down_revision = "0005_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("campaigns", sa.Column("audience", sa.String(20), nullable=False, server_default="everyone"))
    op.add_column("campaigns", sa.Column("audience_filter", sa.JSON(), nullable=True))
    op.add_column("campaigns", sa.Column("follow_up_after_hours", sa.Integer(), nullable=True))
    op.add_column("campaigns", sa.Column("follow_up_audience", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("campaigns", "follow_up_audience")
    op.drop_column("campaigns", "follow_up_after_hours")
    op.drop_column("campaigns", "audience_filter")
    op.drop_column("campaigns", "audience")
