"""wa_templates with lifecycle (Phase 8)

Revision ID: 0007_wa_templates
Revises: 0006_campaign_audience
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0007_wa_templates"
down_revision = "0006_campaign_audience"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "wa_templates",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("account_id", UUID, sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True),
        sa.Column("event_id", UUID, sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("language", sa.String(10), nullable=False, server_default="he"),
        sa.Column("category", sa.String(30)),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("allowed_vars", sa.JSON()),
        sa.Column("components", sa.JSON()),
        sa.Column("lifecycle", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("meta_template_id", sa.String(128)),
        sa.Column("rejection_reason", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_wa_templates_account_id", "wa_templates", ["account_id"])
    op.create_index("ix_wa_templates_event_id", "wa_templates", ["event_id"])


def downgrade() -> None:
    op.drop_index("ix_wa_templates_event_id", table_name="wa_templates")
    op.drop_index("ix_wa_templates_account_id", table_name="wa_templates")
    op.drop_table("wa_templates")
