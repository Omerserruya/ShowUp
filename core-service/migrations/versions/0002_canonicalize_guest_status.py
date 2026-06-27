"""canonicalize legacy guest statuses

Maps historic guest.status values to the canonical GuestStatus vocabulary:
  'attending' -> 'confirmed'
  'pending'   -> 'invited'

After this, core-service reads/writes canonical values. The webhook-worker is
canonicalized in Phase 7; until then GuestStatus.*_values() keeps tolerating
the 'attending' alias on read.

Revision ID: 0002_canon_status
Revises: 0001_baseline
Create Date: 2026-06-13
"""
from alembic import op

revision = "0002_canon_status"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE guests SET status = 'confirmed' WHERE status = 'attending'")
    op.execute("UPDATE guests SET status = 'invited' WHERE status = 'pending'")


def downgrade() -> None:
    # Not meaningfully reversible (the legacy distinction is lost); no-op.
    pass
