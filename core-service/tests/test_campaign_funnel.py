"""Every campaign reports received / seen / answered, at every moment.

The three numbers an owner asks about after a round goes out. They must be
present from the moment the campaign exists (zeros, not "unknown"), correct
mid-send, and never contradict each other.
"""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from tests.conftest import auth_header, make_campaign, make_event, make_guest


def _send(db, campaign_id, guest_id, status, *, wamid=None, replied=False):
    """Record one outbound campaign message in whatever state the test needs."""
    db.execute(
        text(
            """
            INSERT INTO messages_sent (campaign_id, guest_id, status, wa_message_id, replied_at)
            VALUES (:c, :g, :s, :w, CASE WHEN :r THEN NOW() ELSE NULL END)
            ON CONFLICT (campaign_id, guest_id) DO UPDATE
              SET status = EXCLUDED.status,
                  wa_message_id = EXCLUDED.wa_message_id,
                  replied_at = EXCLUDED.replied_at
            """
        ),
        {"c": str(campaign_id), "g": str(guest_id), "s": status, "w": wamid, "r": replied},
    )
    db.commit()


@pytest.fixture(autouse=True)
def _clean_messages(db):
    yield
    db.execute(text("DELETE FROM messages_sent"))
    db.commit()


def test_a_campaign_has_stats_before_it_sends(client, db):
    """Zeros, never a missing block - the UI must not have an 'unknown' state."""
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    make_campaign(db, event_id)

    listed = client.get(f"/campaigns?event_id={event_id}", headers=auth_header(owner)).json()
    assert len(listed) == 1
    assert listed[0]["stats"] == {
        "sent_count": 0, "delivered_count": 0, "read_count": 0, "replied_count": 0,
        "failed_count": 0, "queued_count": 0, "attempted_count": 0,
    }


def test_funnel_counts_each_stage(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    campaign_id = make_campaign(db, event_id)
    guests = [make_guest(db, event_id, phone=f"+97250000000{i}") for i in range(5)]

    _send(db, campaign_id, guests[0], "accepted")                 # sent, not yet delivered
    _send(db, campaign_id, guests[1], "delivered")                # received
    _send(db, campaign_id, guests[2], "read")                     # received + seen
    _send(db, campaign_id, guests[3], "read", replied=True)       # received + seen + answered
    _send(db, campaign_id, guests[4], "failed")                   # never arrived

    stats = client.get(f"/campaigns/{campaign_id}/stats", headers=auth_header(owner)).json()
    assert stats["attempted_count"] == 5
    assert stats["sent_count"] == 4        # accepted + delivered + read + read
    assert stats["delivered_count"] == 3   # delivered + the two reads
    assert stats["read_count"] == 2
    assert stats["replied_count"] == 1
    assert stats["failed_count"] == 1


def test_stats_are_available_mid_send(client, db):
    """A campaign still draining must report what has landed so far."""
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    campaign_id = make_campaign(db, event_id)
    a, b = make_guest(db, event_id, "+972500000011"), make_guest(db, event_id, "+972500000012")

    _send(db, campaign_id, a, "delivered")
    _send(db, campaign_id, b, "queued")

    stats = client.get(f"/campaigns/{campaign_id}/stats", headers=auth_header(owner)).json()
    assert stats["delivered_count"] == 1
    assert stats["queued_count"] == 1
    assert stats["attempted_count"] == 2


def test_a_reply_proves_delivery_even_without_a_receipt(client, db):
    """Read receipts can be off and delivery receipts can be lost, but someone
    who ANSWERED plainly got the message - the funnel must not claim otherwise."""
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    campaign_id = make_campaign(db, event_id)
    guest = make_guest(db, event_id, "+972500000021")

    _send(db, campaign_id, guest, "accepted", replied=True)

    stats = client.get(f"/campaigns/{campaign_id}/stats", headers=auth_header(owner)).json()
    assert stats["replied_count"] == 1
    assert stats["delivered_count"] == 1, "a reply implies delivery"
    assert stats["read_count"] == 0, "replies must not be counted as reads"


def test_delivered_never_exceeds_accepted(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    campaign_id = make_campaign(db, event_id)
    guest = make_guest(db, event_id, "+972500000031")
    _send(db, campaign_id, guest, "read")

    stats = client.get(f"/campaigns/{campaign_id}/stats", headers=auth_header(owner)).json()
    assert stats["read_count"] <= stats["delivered_count"] <= stats["sent_count"] <= stats["attempted_count"]


def test_list_returns_stats_for_every_campaign_in_one_call(client, db):
    """The list is the only request the dashboard makes - N campaigns must not
    become N+1 requests, and none may come back without its funnel."""
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    first = make_campaign(db, event_id)
    second = db.execute(
        text("INSERT INTO campaigns (id, event_id, name, template, channel, status) "
             "VALUES (gen_random_uuid(), :e, 'Round 2', 'event_no_pic', 'whatsapp', 'sent') RETURNING id"),
        {"e": str(event_id)},
    ).scalar()
    db.commit()

    g1 = make_guest(db, event_id, "+972500000041")
    _send(db, first, g1, "read", replied=True)

    listed = client.get(f"/campaigns?event_id={event_id}", headers=auth_header(owner)).json()
    by_id = {c["id"]: c["stats"] for c in listed}
    assert len(by_id) == 2
    assert by_id[str(first)]["replied_count"] == 1
    assert by_id[str(second)]["attempted_count"] == 0


def test_stats_require_campaign_read_permission(client, db):
    owner, stranger = uuid.uuid4(), uuid.uuid4()
    event_id = make_event(db, owner)
    campaign_id = make_campaign(db, event_id)

    assert client.get(f"/campaigns/{campaign_id}/stats", headers=auth_header(stranger)).status_code == 404


# --- reply attribution -----------------------------------------------------
#
# The statements below are the exact ones webhook-worker issues when a guest
# answers. They live in shared/domain/delivery.py so both services agree on what
# "answered" means; these tests are that contract, run against real Postgres.

def _attribute_reply(db, *, event_id, phone, wamid=None):
    from shared.domain.delivery import (
        REPLY_BY_RECENCY_SQL, REPLY_BY_WAMID_SQL, phone_match_suffix,
    )

    rows = 0
    if wamid:
        rows = db.execute(text(REPLY_BY_WAMID_SQL), {"wamid": wamid}).rowcount or 0
    if not rows:
        digits = "".join(ch for ch in phone if ch.isdigit())
        db.execute(text(REPLY_BY_RECENCY_SQL),
                   {"event_id": str(event_id), "suffix": phone_match_suffix(digits)})
    db.commit()


def _replied(db, campaign_id, guest_id) -> bool:
    return db.execute(
        text("SELECT replied_at IS NOT NULL FROM messages_sent "
             "WHERE campaign_id = :c AND guest_id = :g"),
        {"c": str(campaign_id), "g": str(guest_id)},
    ).scalar()


def test_reply_is_credited_to_the_most_recent_round(client, db):
    """A guest who got two reminders and then answered credits the LAST one -
    that is the message they actually responded to."""
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    first, second = make_campaign(db, event_id), make_campaign(db, event_id)
    guest = make_guest(db, event_id, "+972501112233")

    _send(db, first, guest, "delivered")
    db.execute(text("UPDATE messages_sent SET sent_at = NOW() - INTERVAL '2 days' "
                    "WHERE campaign_id = :c"), {"c": str(first)})
    db.commit()
    _send(db, second, guest, "delivered")

    _attribute_reply(db, event_id=event_id, phone="972501112233")

    assert _replied(db, second, guest) is True
    assert _replied(db, first, guest) is False


def test_reply_matches_stored_phone_variants(client, db):
    """Guest lists hold 0501112244 / +972501112244 / 972501112244 for the same
    person; WhatsApp always reports the last form."""
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    campaign_id = make_campaign(db, event_id)
    guest = make_guest(db, event_id, "0501112244")

    _send(db, campaign_id, guest, "delivered")
    _attribute_reply(db, event_id=event_id, phone="972501112244")

    assert _replied(db, campaign_id, guest) is True


def test_reply_to_a_specific_message_credits_that_message(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    old_round, new_round = make_campaign(db, event_id), make_campaign(db, event_id)
    guest = make_guest(db, event_id, "+972501112255")

    _send(db, old_round, guest, "delivered", wamid="wamid.OLD")
    _send(db, new_round, guest, "delivered", wamid="wamid.NEW")

    # They scrolled up and replied to the OLDER message - recency would be wrong.
    _attribute_reply(db, event_id=event_id, phone="972501112255", wamid="wamid.OLD")

    assert _replied(db, old_round, guest) is True
    assert _replied(db, new_round, guest) is False


def test_a_chatty_guest_counts_once(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    campaign_id = make_campaign(db, event_id)
    guest = make_guest(db, event_id, "+972501112266")
    _send(db, campaign_id, guest, "delivered")

    for _ in range(3):
        _attribute_reply(db, event_id=event_id, phone="972501112266")

    stats = client.get(f"/campaigns/{campaign_id}/stats", headers=auth_header(owner)).json()
    assert stats["replied_count"] == 1


def test_a_reply_never_credits_a_message_we_did_not_send(client, db):
    """A message still sitting in the queue cannot be what the guest answered."""
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    campaign_id = make_campaign(db, event_id)
    guest = make_guest(db, event_id, "+972501112277")
    _send(db, campaign_id, guest, "queued")

    _attribute_reply(db, event_id=event_id, phone="972501112277")

    assert _replied(db, campaign_id, guest) is False


def test_a_reply_stays_inside_its_own_event(client, db):
    """The same person can be a guest at two weddings; answering one must not
    mark the other's round as answered."""
    owner = uuid.uuid4()
    mine, theirs = make_event(db, owner), make_event(db, uuid.uuid4())
    my_campaign, their_campaign = make_campaign(db, mine), make_campaign(db, theirs)
    my_guest = make_guest(db, mine, "+972501112288")
    their_guest = make_guest(db, theirs, "+972501112288")

    _send(db, my_campaign, my_guest, "delivered")
    _send(db, their_campaign, their_guest, "delivered")

    _attribute_reply(db, event_id=mine, phone="972501112288")

    assert _replied(db, my_campaign, my_guest) is True
    assert _replied(db, their_campaign, their_guest) is False
