"""baseline: explicit V1 schema (frozen)

This project had no migration history; the schema was previously created at
runtime via Base.metadata.create_all(). This baseline freezes the V1 schema as
explicit DDL so that all later V2 changes are proper, reviewable migrations.

It must NOT be regenerated from live model metadata — the models evolve in later
revisions, and a metadata-driven baseline would collide with those migrations.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "events",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("owners", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("inviters", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("event_date", sa.DateTime(timezone=True)),
        sa.Column("location", sa.Text()),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("plan_id", sa.String(50)),
        sa.Column("seating_layout", sa.JSON()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "guests",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("event_id", UUID, sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("guest_group", sa.String(100)),
        sa.Column("phone", sa.String(20), nullable=False),
        sa.Column("email", sa.String(100)),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("import_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("guest_count", sa.Integer()),
        sa.Column("table_number", sa.Integer()),
        sa.Column("notes", sa.Text()),
        sa.Column("last_response", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_guests_phone", "guests", ["phone"])

    op.create_table(
        "campaigns",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("event_id", UUID, sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("template", sa.Text(), nullable=False),
        sa.Column("channel", sa.String(20), nullable=False),
        sa.Column("schedule_time", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("recipient_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "guest_imports",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("event_id", UUID, sa.ForeignKey("events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source", sa.String(50), nullable=False, server_default="whatsapp"),
        sa.Column("raw_payload", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("message_id", sa.String(128), unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "guest_import_contacts",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("import_id", UUID, sa.ForeignKey("guest_imports.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200)),
        sa.Column("phone", sa.String(20)),
        sa.Column("email", sa.String(100)),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("validation_errors", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("guest_import_contacts")
    op.drop_table("guest_imports")
    op.drop_table("campaigns")
    op.drop_index("ix_guests_phone", table_name="guests")
    op.drop_table("guests")
    op.drop_table("events")
