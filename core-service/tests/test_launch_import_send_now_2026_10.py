"""Launch fixes 2026-10: guest file import report, phone canonicalisation,
draft -> pending "send now", and the empty-audience refusal."""
from __future__ import annotations

import io
import uuid

from tests.conftest import auth_header, make_event, make_guest


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _csv(rows):
    text = "\n".join(",".join(r) for r in rows) + "\n"
    return io.BytesIO(text.encode("utf-8-sig"))


def _upload(client, owner, event_id, rows, *, dry_run=False, filename="guests.csv"):
    url = f"/guests/bulk?event_id={event_id}" + ("&dry_run=true" if dry_run else "")
    return client.post(url, headers=auth_header(owner),
                       files={"file": (filename, _csv(rows), "text/csv")})


def _phones(db, event_id):
    from app.models.models import Guest
    return sorted(g.phone for g in db.query(Guest).filter(Guest.event_id == str(event_id)).all())


def _campaign(db, event_id, status="draft", schedule_time=None, audience="everyone"):
    from app.models.models import Campaign
    c = Campaign(event_id=str(event_id), name="Invite", template="event_no_pic",
                 channel="whatsapp", status=status, schedule_time=schedule_time, audience=audience)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c.id


# ---------------------------------------------------------------------------
# phone canonicalisation
# ---------------------------------------------------------------------------

def test_canonical_phone_forms():
    from app.crud.guest import canonical_phone
    for raw in ("0501234567", "050-123-4567", "501234567", "972501234567", "+972 50 123 4567",
                "00972501234567", 501234567, 501234567.0, "+972-0501234567"):
        assert canonical_phone(raw) == "+972501234567", raw
    assert canonical_phone("+1 415 555 0100") == "+14155550100"
    for bad in ("", None, "abc", "123", "05012"):
        assert canonical_phone(bad) is None, bad


# ---------------------------------------------------------------------------
# bulk import report
# ---------------------------------------------------------------------------

def test_bulk_import_skips_duplicates_and_invalid_rows(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    make_guest(db, event_id, phone="0509999999")  # legacy local format already on the list

    r = _upload(client, owner, event_id, [
        ["שם מלא", "טלפון", "כמות מוזמנים"],
        ["Dana", "050-111-1111", "2"],
        ["Avi", "+972 50 999 9999", "1"],   # already in event (other format)
        ["Dana again", "0501111111", "1"],  # repeated in file
        ["", "0502222222", "1"],            # missing name
        ["Bad", "12", "1"],                 # invalid phone
        ["Noa", "502222222", "1"],          # leading 0 dropped by Excel
    ])
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["created"] == 2
    assert rep["capacity_reached"] is False
    dups = {d["row"]: d["reason"] for d in rep["skipped_duplicates"]}
    assert dups == {3: "already_in_event", 4: "repeated_in_file"}
    assert sorted(i["row"] for i in rep["skipped_invalid"]) == [5, 6]
    assert {g["phone"] for g in rep["guests"]} == {"+972501111111", "+972502222222"}
    # import_count from the template's "כמות מוזמנים" header is honoured
    assert {g["name"]: g["import_count"] for g in rep["guests"]}["Dana"] == 2
    assert _phones(db, event_id) == ["+972501111111", "+972502222222", "0509999999"]


def test_bulk_import_dry_run_creates_nothing(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    r = _upload(client, owner, event_id, [["name", "phone"], ["A", "0501111111"], ["B", "x"]], dry_run=True)
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["dry_run"] is True and rep["created"] == 1 and len(rep["skipped_invalid"]) == 1
    assert _phones(db, event_id) == []


def test_bulk_import_stops_at_capacity(client, db):
    from app.models.models import Event
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    ev = db.query(Event).filter(Event.id == event_id).first()
    ev.max_guests_override = 3
    db.commit()
    make_guest(db, event_id, phone="+972500000001")  # 1 of 3 used

    r = _upload(client, owner, event_id, [
        ["name", "phone"], ["A", "0501111111"], ["B", "0502222222"], ["C", "0503333333"], ["D", "0504444444"],
    ])
    assert r.status_code == 200, r.text
    rep = r.json()
    assert rep["created"] == 2
    assert rep["capacity_reached"] is True
    assert rep["skipped_capacity"] == 2
    assert len(_phones(db, event_id)) == 3


def test_manual_add_normalizes_and_rejects_duplicate(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    r = client.post(f"/guests?event_id={event_id}", headers=auth_header(owner),
                    json={"name": "Dana", "phone": "050-111-1111"})
    assert r.status_code == 201, r.text
    assert _phones(db, event_id) == ["+972501111111"]

    r = client.post(f"/guests?event_id={event_id}", headers=auth_header(owner),
                    json={"name": "Dana 2", "phone": "+972501111111"})
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "duplicate_phone"


# ---------------------------------------------------------------------------
# send now
# ---------------------------------------------------------------------------

def test_send_now_moves_draft_to_pending(client, db):
    from app.models.models import Campaign
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    make_guest(db, event_id)
    cid = _campaign(db, event_id, status="draft")

    r = client.put(f"/campaigns/{cid}", headers=auth_header(owner), json={"send_now": True})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert body["schedule_time"] is not None
    assert "status_reason" in body
    db.expire_all()
    c = db.query(Campaign).filter(Campaign.id == cid).first()
    assert c.status == "pending" and c.recipient_count == 1


def test_schedule_draft_with_pending_status_is_allowed(client, db):
    import datetime as dt
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    make_guest(db, event_id)
    cid = _campaign(db, event_id, status="draft")
    when = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)).isoformat()
    r = client.put(f"/campaigns/{cid}", headers=auth_header(owner),
                   json={"schedule_time": when, "status": "pending"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pending"


def test_send_now_refuses_empty_audience(client, db):
    from app.models.models import Campaign
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    cid = _campaign(db, event_id, status="draft")  # no guests at all

    r = client.put(f"/campaigns/{cid}", headers=auth_header(owner), json={"send_now": True})
    assert r.status_code == 400, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "no_recipients"
    assert detail["message"]
    db.expire_all()
    c = db.query(Campaign).filter(Campaign.id == cid).first()
    assert c.status == "draft" and c.schedule_time is None


def test_send_now_retries_failed_round_that_sent_nothing(client, db):
    owner = uuid.uuid4()
    event_id = make_event(db, owner)
    make_guest(db, event_id)
    cid = _campaign(db, event_id, status="failed")
    r = client.put(f"/campaigns/{cid}", headers=auth_header(owner), json={"send_now": True})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pending"
