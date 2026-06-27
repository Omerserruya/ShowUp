"""accounts, memberships, events.account_id (V2 tenancy + RBAC)

Additive: events.account_id is nullable so existing rows are untouched; legacy
ownership via events.owners keeps working through the authz bridge until events
are backfilled to accounts.

Revision ID: 0003_tenancy
Revises: 0002_canon_status
Create Date: 2026-06-13
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003_tenancy"
down_revision = "0002_canon_status"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=True)


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("name", sa.String(200)),
        sa.Column("billing_email", sa.String(100)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "memberships",
        sa.Column("id", UUID, primary_key=True),
        sa.Column("account_id", UUID, sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("role", sa.String(30), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("account_id", "user_id", name="uq_membership_account_user"),
    )
    op.create_index("ix_memberships_account_id", "memberships", ["account_id"])
    op.create_index("ix_memberships_user_id", "memberships", ["user_id"])

    op.add_column("events", sa.Column("account_id", UUID, nullable=True))
    op.create_foreign_key(
        "fk_events_account_id", "events", "accounts", ["account_id"], ["id"], ondelete="CASCADE"
    )
    op.create_index("ix_events_account_id", "events", ["account_id"])


def downgrade() -> None:
    op.drop_index("ix_events_account_id", table_name="events")
    op.drop_constraint("fk_events_account_id", "events", type_="foreignkey")
    op.drop_column("events", "account_id")
    op.drop_index("ix_memberships_user_id", table_name="memberships")
    op.drop_index("ix_memberships_account_id", table_name="memberships")
    op.drop_table("memberships")
    op.drop_table("accounts")
