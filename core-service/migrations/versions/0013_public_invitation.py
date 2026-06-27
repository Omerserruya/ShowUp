"""Public web invitation: slug + design config + published flag (Phase 16)

Revision ID: 0013_public_invitation
Revises: 0012_assistant
Create Date: 2026-06-17
"""
from alembic import op
import sqlalchemy as sa

revision = "0013_public_invitation"
down_revision = "0012_assistant"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("public_slug", sa.String(120), nullable=True))
    op.add_column("events", sa.Column("invitation", sa.JSON(), nullable=True))
    op.add_column(
        "events",
        sa.Column(
            "invitation_published",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_unique_constraint("uq_events_public_slug", "events", ["public_slug"])
    op.create_index("ix_events_public_slug", "events", ["public_slug"])


def downgrade() -> None:
    op.drop_index("ix_events_public_slug", table_name="events")
    op.drop_constraint("uq_events_public_slug", "events", type_="unique")
    op.drop_column("events", "invitation_published")
    op.drop_column("events", "invitation")
    op.drop_column("events", "public_slug")
