"""AI assistant: identity links + sessions (Phase 12)

Revision ID: 0012_assistant
Revises: 0011_audit_log
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0012_assistant"
down_revision = "0011_audit_log"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "assistant_identity_links",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("phone", sa.String(20), nullable=False, unique=True),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("verified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_assistant_links_user_id", "assistant_identity_links", ["user_id"])

    op.create_table(
        "assistant_sessions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("account_id", UUID, nullable=True),
        sa.Column("event_id", UUID, sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel", sa.String(30), nullable=False, server_default="whatsapp_assistant"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_assistant_sessions_user_id", "assistant_sessions", ["user_id"])
    op.create_index("ix_assistant_sessions_event_id", "assistant_sessions", ["event_id"])


def downgrade() -> None:
    op.drop_index("ix_assistant_sessions_event_id", table_name="assistant_sessions")
    op.drop_index("ix_assistant_sessions_user_id", table_name="assistant_sessions")
    op.drop_table("assistant_sessions")
    op.drop_index("ix_assistant_links_user_id", table_name="assistant_identity_links")
    op.drop_table("assistant_identity_links")
