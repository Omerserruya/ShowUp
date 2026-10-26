"""The catalog must say which templates are deliverable PER EVENT TYPE.

Meta approves the event-type variant (`<key>__wedding`), not the base template,
so the global `sendable` flag is a poor filter: a client that used it offered a
wedding 6 templates out of the 17 it can actually send. `sendable_event_types`
is the field clients filter on, and it has to agree with the gate that campaign
creation enforces - otherwise the UI either hides usable templates or offers
ones the API will reject.
"""
from __future__ import annotations

import uuid

import pytest

from tests.conftest import auth_header, make_event


@pytest.fixture()
def catalog(client):
    res = client.get("/catalog")
    assert res.status_code == 200
    return res.json()


def test_every_template_declares_its_event_types(catalog):
    assert catalog["templates"], "catalog must not be empty"
    for t in catalog["templates"]:
        assert isinstance(t.get("sendable_event_types"), list), t["id"]


def test_per_event_type_is_broader_than_the_global_flag(catalog):
    """The whole point: the global flag is far too pessimistic."""
    templates = catalog["templates"]
    globally = sum(1 for t in templates if t["sendable"])
    for event_type in ("wedding", "bar", "birthday"):
        usable = sum(1 for t in templates if event_type in t["sendable_event_types"])
        assert usable > globally, (
            f"{event_type}: {usable} usable vs {globally} by the global flag - if these "
            f"ever match, clients are back to hiding most of the catalog"
        )


def test_event_types_differ_from_each_other(catalog):
    """A wedding and a bar mitzvah do NOT have the same set - which is exactly
    why a single global flag cannot express deliverability."""
    by_type = {
        et: {t["id"] for t in catalog["templates"] if et in t["sendable_event_types"]}
        for et in ("wedding", "bar")
    }
    assert by_type["wedding"] != by_type["bar"]


def test_a_globally_unsendable_template_can_still_be_offered(catalog):
    """The case the old filter got wrong: base template not sendable, but its
    event-type variant is live."""
    hidden_but_usable = [
        t for t in catalog["templates"]
        if not t["sendable"] and t["sendable_event_types"]
    ]
    assert hidden_but_usable, "expected at least one template the global flag hides"


@pytest.mark.parametrize("event_type", ["wedding", "bar", "birthday"])
def test_offered_templates_are_accepted_by_campaign_creation(client, db, catalog, event_type):
    """The contract that matters: everything the catalog offers for an event type
    must survive the campaign-creation deliverability gate. If these drift, the
    owner picks a template and gets a 400."""
    from app.models.models import Event

    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    db.query(Event).filter(Event.id == str(event_id)).update({"event_type": event_type})
    db.commit()

    offered = [t for t in catalog["templates"] if event_type in t["sendable_event_types"]]
    assert offered

    for t in offered:
        res = client.post(
            f"/campaigns?event_id={event_id}",
            json={"name": t["id"][:100], "template": t["id"], "channel": "whatsapp",
                  "event_id": str(event_id)},
            headers=auth_header(owner),
        )
        assert res.status_code != 400, (
            f"catalog offers '{t['id']}' for {event_type} but creation rejected it: {res.text[:200]}"
        )
