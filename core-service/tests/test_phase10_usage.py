"""Phase 10 — Usage metering + enforcement tests."""
from __future__ import annotations

import uuid

from app.usage import usage_total, would_exceed, record_usage
from shared.domain.enums import UsageMetric
from shared.domain.roles import Role
from tests.conftest import auth_header, make_account_with_event


def _guest_body(phone):
    return {"name": "G", "phone": phone}


def test_guest_add_metered(client, db):
    owner = uuid.uuid4()
    account_id, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    r = client.post(f"/guests?event_id={event_id}",
                    json=[_guest_body("+972500000001"), _guest_body("+972500000002")],
                    headers=auth_header(owner))
    assert r.status_code == 201, r.text
    assert usage_total(db, account_id, UsageMetric.GUEST_ADDED) == 2


def test_round_launch_metered(client, db):
    owner = uuid.uuid4()
    account_id, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    r = client.post(f"/campaigns?event_id={event_id}",
                    json={"name": "R1", "template": "event_no_pic", "channel": "whatsapp"},
                    headers=auth_header(owner))
    assert r.status_code == 201, r.text
    assert usage_total(db, account_id, UsageMetric.ROUND_LAUNCHED) == 1


def test_would_exceed_logic(client, db):
    owner = uuid.uuid4()
    account_id, event_id = make_account_with_event(db, {owner: Role.OWNER.value})
    record_usage(db, account_id=account_id, event_id=event_id, metric=UsageMetric.GUEST_ADDED, quantity=8)
    assert would_exceed(db, account_id, UsageMetric.GUEST_ADDED, limit=10, additional=3) is True
    assert would_exceed(db, account_id, UsageMetric.GUEST_ADDED, limit=10, additional=2) is False
    # None limit = unlimited; None account = unmetered
    assert would_exceed(db, account_id, UsageMetric.GUEST_ADDED, limit=None, additional=999) is False
    assert would_exceed(db, None, UsageMetric.GUEST_ADDED, limit=1, additional=999) is False


def test_usage_total_none_account_is_zero(db):
    assert usage_total(db, None, UsageMetric.MESSAGE_SENT) == 0
