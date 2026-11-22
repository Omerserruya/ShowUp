"""Delete a user's account and the data that belongs to it (App Store 5.1.1(v):
an app with sign-up must let the user delete the account from inside it).

What goes:
  - the user row, sign-in history, push devices, assistant links/sessions,
    memberships, team invitations they sent or received, demo-lead rows;
  - every event of a PERSONAL account where the user is the only owner, with
    everything hanging off it: guests, rounds and their send logs, guest
    conversations, phone-call rounds and calls, notifications, hostess links...
    Then the account itself. Pending rounds and calls disappear with their rows,
    so nothing is sent on the user's behalf afterwards.

What stays:
  - events of an account that has another owner, and of venue accounts
    (the venue owns them): only the user's membership is removed;
  - orders, as payment records (amounts, plan, dates, iCount sale id), with the
    personal fields blanked. The tax invoice itself lives at iCount.

All in one transaction; tables that don't exist in this database are skipped.
`delete_account(conn, user_id)` returns a small summary for the audit log.
"""
from __future__ import annotations

from typing import Iterable

# Tables keyed by event_id WITHOUT a foreign key to events (so a plain event
# delete leaves them behind). Tables with ON DELETE CASCADE (guests, campaigns,
# guest_imports, event_field_defs, guest_events, usage_events, wa_templates,
# hostess_links, guest_checkins, assistant_sessions) go with the event row.
_EVENT_TABLES = (
    "admin_support_sessions",
    "assistant_pending_actions",
    "assistant_turns",
    "campaign_releases",
    "conversations",
    "daily_summaries",
    "owner_notifications",
    "push_outbox",
    "team_invitations",
    "voice_calls",
    "voice_event_settings",
    "voice_rounds",
)

_USER_TABLES = (
    "push_devices",
    "push_outbox",
    "assistant_identity_links",
    "assistant_sessions",
    "assistant_turns",
    "assistant_pending_actions",
    "login_history",
    "team_invitations",
)


class AccountDeletionRefused(Exception):
    """The account may not be self-deleted (e.g. a platform admin)."""


def _exists(cur, table: str) -> bool:
    cur.execute("SELECT to_regclass(%s)", (f"public.{table}",))
    return cur.fetchone()[0] is not None


def _has_column(cur, table: str, column: str) -> bool:
    cur.execute(
        "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=%s AND column_name=%s",
        (table, column),
    )
    return cur.fetchone() is not None


def _delete_where_in(cur, table: str, column: str, ids: Iterable[str]) -> int:
    ids = [str(i) for i in ids]
    if not ids or not _exists(cur, table) or not _has_column(cur, table, column):
        return 0
    cur.execute(f"DELETE FROM {table} WHERE {column}::text = ANY(%s)", (ids,))
    return cur.rowcount


def delete_account(conn, user_id: str) -> dict:
    """Delete the account inside the caller's connection, committing at the end.
    Raises LookupError when the user doesn't exist and AccountDeletionRefused for
    admins."""
    user_id = str(user_id)
    summary = {"events_deleted": 0, "accounts_deleted": 0, "memberships_removed": 0, "orders_anonymized": 0}
    prev_autocommit = conn.autocommit
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT phone, COALESCE(role,'user') FROM users WHERE id::text = %s FOR UPDATE", (user_id,))
            row = cur.fetchone()
            if not row:
                raise LookupError("user_not_found")
            phone, role = row
            if role == "admin":
                raise AccountDeletionRefused("admin_account")

            # Accounts to delete whole: personal, and no other owner.
            doomed_accounts: list[str] = []
            if _exists(cur, "memberships") and _exists(cur, "accounts"):
                cur.execute(
                    """
                    SELECT a.id::text
                      FROM memberships m JOIN accounts a ON a.id = m.account_id
                     WHERE m.user_id::text = %s
                       AND COALESCE(a.type, 'personal') = 'personal'
                       AND NOT EXISTS (
                           SELECT 1 FROM memberships o
                            WHERE o.account_id = a.id AND o.user_id::text <> %s
                              AND o.role = 'owner' AND COALESCE(o.status, 'active') = 'active')
                    """,
                    (user_id, user_id),
                )
                doomed_accounts = [r[0] for r in cur.fetchall()]

            event_ids: list[str] = []
            if doomed_accounts:
                cur.execute("SELECT id::text FROM events WHERE account_id::text = ANY(%s)", (doomed_accounts,))
                event_ids = [r[0] for r in cur.fetchall()]

            campaign_ids: list[str] = []
            if event_ids and _exists(cur, "campaigns"):
                cur.execute("SELECT id::text FROM campaigns WHERE event_id::text = ANY(%s)", (event_ids,))
                campaign_ids = [r[0] for r in cur.fetchall()]

            # Payment records stay, without the personal details.
            if _exists(cur, "orders"):
                cur.execute(
                    """
                    UPDATE orders
                       SET first_name = '', last_name = '', phone = 'deleted', email = NULL,
                           inviters = NULL, subjects = NULL, location = NULL,
                           event_name = 'נמחק', event_description = NULL,
                           access_token = NULL
                     WHERE phone = %s OR event_id::text = ANY(%s)
                    """,
                    (phone, event_ids),
                )
                summary["orders_anonymized"] = cur.rowcount

            _delete_where_in(cur, "messages_sent", "campaign_id", campaign_ids)
            _delete_where_in(cur, "messages_log", "campaign_id", campaign_ids)
            # messages_log.conversation_id -> conversations has no cascade: guest
            # replies outside a campaign (e.g. a public-invite RSVP) block the
            # conversations delete below (2026-11-22, App Review recording).
            if event_ids and _exists(cur, "conversations") and _has_column(cur, "messages_log", "conversation_id"):
                cur.execute(
                    "DELETE FROM messages_log WHERE conversation_id IN "
                    "(SELECT id FROM conversations WHERE event_id::text = ANY(%s))",
                    (event_ids,),
                )
            for table in _EVENT_TABLES:
                _delete_where_in(cur, table, "event_id", event_ids)

            if event_ids:
                if _exists(cur, "entitlements"):
                    cur.execute(
                        "UPDATE entitlements SET redeemed_event_id = NULL WHERE redeemed_event_id::text = ANY(%s)",
                        (event_ids,),
                    )
                cur.execute("DELETE FROM events WHERE id::text = ANY(%s)", (event_ids,))
                summary["events_deleted"] = cur.rowcount
            if doomed_accounts:
                cur.execute("DELETE FROM accounts WHERE id::text = ANY(%s)", (doomed_accounts,))
                summary["accounts_deleted"] = cur.rowcount

            summary["memberships_removed"] = _delete_where_in(cur, "memberships", "user_id", [user_id])
            for table in _USER_TABLES:
                _delete_where_in(cur, table, "user_id", [user_id])
            if _exists(cur, "entitlements") and _has_column(cur, "entitlements", "redeemed_by_user_id"):
                cur.execute("UPDATE entitlements SET redeemed_by_user_id = NULL WHERE redeemed_by_user_id::text = %s", (user_id,))
            for table in ("team_invitations", "assistant_identity_links", "demo_leads"):
                _delete_where_in(cur, table, "phone", [phone])

            cur.execute("DELETE FROM users WHERE id::text = %s", (user_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.autocommit = prev_autocommit
    return summary
