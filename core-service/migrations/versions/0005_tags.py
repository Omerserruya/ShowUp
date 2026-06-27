"""tags: tags + guest_tags (Phase 5)

Revision ID: 0005_tags
Revises: 0004_custom_fields
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0005_tags"
down_revision = "0004_custom_fields"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "tags",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("account_id", UUID, sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(50), nullable=False),
        sa.Column("color", sa.String(20)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("account_id", "name", name="uq_tag_account_name"),
    )
    op.create_index("ix_tags_account_id", "tags", ["account_id"])

    op.create_table(
        "guest_tags",
        sa.Column("guest_id", UUID, sa.ForeignKey("guests.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("tag_id", UUID, sa.ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_index("ix_guest_tags_tag_id", "guest_tags", ["tag_id"])


def downgrade() -> None:
    op.drop_index("ix_guest_tags_tag_id", table_name="guest_tags")
    op.drop_table("guest_tags")
    op.drop_index("ix_tags_account_id", table_name="tags")
    op.drop_table("tags")
