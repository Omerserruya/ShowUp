"""custom fields: event_field_defs + guest_custom_values (Phase 4)

Revision ID: 0004_custom_fields
Revises: 0003_tenancy
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004_custom_fields"
down_revision = "0003_tenancy"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "event_field_defs",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("event_id", UUID, sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.String(50), nullable=False),
        sa.Column("label", sa.String(100), nullable=False),
        sa.Column("data_type", sa.String(20), nullable=False),
        sa.Column("options", sa.JSON()),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("applies_to_template", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("event_id", "key", name="uq_field_event_key"),
    )
    op.create_index("ix_event_field_defs_event_id", "event_field_defs", ["event_id"])

    op.create_table(
        "guest_custom_values",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("guest_id", UUID, sa.ForeignKey("guests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("field_def_id", UUID, sa.ForeignKey("event_field_defs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("value", sa.JSON()),
        sa.UniqueConstraint("guest_id", "field_def_id", name="uq_value_guest_field"),
    )
    op.create_index("ix_guest_custom_values_guest_id", "guest_custom_values", ["guest_id"])


def downgrade() -> None:
    op.drop_index("ix_guest_custom_values_guest_id", table_name="guest_custom_values")
    op.drop_table("guest_custom_values")
    op.drop_index("ix_event_field_defs_event_id", table_name="event_field_defs")
    op.drop_table("event_field_defs")
