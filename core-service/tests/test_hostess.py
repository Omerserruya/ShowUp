"""Entrance hostess mode (link, check-in, walk-ins, table load) + venue seating export."""
from __future__ import annotations

import datetime as dt
import io
import uuid

from shared.domain.roles import Role
from tests.conftest import auth_header, make_account_with_event


def _setup(db, role=Role.OWNER.value):
    from app.models.models import Event, Guest
    user = uuid.uuid4()
    _, event_id = make_account_with_event(db, {user: role})
    ev = db.query(Event).filter(Event.id == event_id).first()
    ev.seating_layout = {"tables": [{"id": "1", "name": "משפחה", "seats": 10},
                                    {"id": "2", "name": "חברים", "seats": 8}]}
    rows = [
        Guest(event_id=event_id, name="דנה כהן", phone="+972501234567", status="attending",
              import_count=2, guest_count=4, table_number=1, group="כלה"),
        Guest(event_id=event_id, name="רון לוי", phone="+972521111111", status="invited",
              import_count=2, table_number=2),
        Guest(event_id=event_id, name="מיכל", phone="+972531112222", status="declined", import_count=1),
    ]
    db.add_all(rows)
    db.commit()
    return user, event_id, [str(g.id) for g in rows]


def _link(client, user, event_id):
    r = client.post(f"/events/{event_id}/hostess", headers=auth_header(user))
    assert r.status_code == 200, r.text
    return r.json()["token"]


def test_link_lifecycle_and_permissions(client, db):
    owner, event_id, _ = _setup(db)
    h = auth_header(owner)
    assert client.get(f"/events/{event_id}/hostess", headers=h).json()["enabled"] is False
    token = _link(client, owner, event_id)
    assert len(token) >= 40
    assert client.post(f"/events/{event_id}/hostess", headers=h).json()["token"] == token  # stable
    rotated = client.post(f"/events/{event_id}/hostess?rotate=true", headers=h).json()["token"]
    assert rotated != token
    assert client.get(f"/public/hostess/{token}").status_code == 404
    assert client.get(f"/public/hostess/{rotated}").status_code == 200
    assert client.delete(f"/events/{event_id}/hostess", headers=h).status_code == 204
    assert client.get(f"/public/hostess/{rotated}").status_code == 404

    viewer, ev2, _ = _setup(db, Role.VIEWER.value)
    assert client.post(f"/events/{ev2}/hostess", headers=auth_header(viewer)).status_code == 403
    stranger = uuid.uuid4()
    assert client.post(f"/events/{event_id}/hostess", headers=auth_header(stranger)).status_code == 404
    assert client.post(f"/events/{event_id}/hostess").status_code == 401


def test_view_hides_phones_and_counts_expected(client, db):
    owner, event_id, (dana, ron, michal) = _setup(db)
    token = _link(client, owner, event_id)
    body = client.get(f"/public/hostess/{token}").json()
    by_name = {g["name"]: g for g in body["guests"]}
    assert by_name["דנה כהן"]["expected"] == 4          # confirmed count wins
    assert by_name["רון לוי"]["expected"] == 2          # not answered -> invited count
    assert by_name["דנה כהן"]["phone_tail"] == "4567"
    assert "+972501234567" not in str(body)
    assert body["stats"]["expected_people"] == 4
    t1 = next(t for t in body["tables"] if t["number"] == 1)
    assert (t1["name"], t1["seats"], t1["planned"], t1["seated"]) == ("משפחה", 10, 4, 0)


def test_checkin_walkin_and_table_load(client, db):
    owner, event_id, (dana, ron, michal) = _setup(db)
    token = _link(client, owner, event_id)
    base = f"/public/hostess/{token}"

    r = client.post(f"{base}/checkins", json={"guest_id": dana, "count": 3})
    assert r.status_code == 200 and r.json()["seated_table"] == 1
    # second tablet corrects the same party -> still one row
    assert client.post(f"{base}/checkins", json={"guest_id": dana, "count": 4}).status_code == 200
    # unanswered guest shows up anyway, moved to table 1
    assert client.post(f"{base}/checkins", json={"guest_id": ron, "count": 2, "table_number": 1}).status_code == 200
    w = client.post(f"{base}/walkins", json={"name": "דוד אורח", "count": 2, "table_number": 2})
    assert w.status_code == 201
    wid = w.json()["id"]

    body = client.get(base).json()
    s = body["stats"]
    assert (s["arrived_people"], s["arrived_parties"], s["walkin_people"]) == (8, 3, 2)
    t = {x["number"]: x for x in body["tables"]}
    assert t[1]["seated"] == 6 and t[2]["seated"] == 2
    assert next(g for g in body["guests"] if g["id"] == ron)["seated_table"] == 1

    assert client.patch(f"{base}/walkins/{wid}", json={"count": 3, "clear_table": True}).status_code == 200
    assert client.delete(f"{base}/checkins/{dana}").status_code == 204
    body = client.get(base).json()
    assert body["stats"]["arrived_people"] == 5
    assert body["walkins"][0]["table"] is None
    assert client.delete(f"{base}/walkins/{wid}").status_code == 204
    assert client.get(base).json()["walkins"] == []

    # walk-ins never become guests (never messaged)
    from app.models.models import Guest
    assert db.query(Guest).filter(Guest.event_id == event_id).count() == 3


def test_validation_and_cross_event(client, db):
    owner, event_id, (dana, *_rest) = _setup(db)
    token = _link(client, owner, event_id)
    other_owner, other_event, (other_guest, *_r) = _setup(db)
    base = f"/public/hostess/{token}"
    assert client.post(f"{base}/checkins", json={"guest_id": dana, "count": 0}).status_code == 422
    assert client.post(f"{base}/checkins", json={"guest_id": dana, "count": 51}).status_code == 422
    assert client.post(f"{base}/checkins", json={"guest_id": other_guest, "count": 1}).status_code == 404
    assert client.post(f"{base}/walkins", json={"name": "", "count": 1}).status_code == 422
    assert client.get("/public/hostess/short").status_code == 404


def test_link_expires_after_event(client, db):
    from app.models.models import Event
    owner, event_id, _ = _setup(db)
    token = _link(client, owner, event_id)
    ev = db.query(Event).filter(Event.id == event_id).first()
    ev.event_date = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=3)
    db.commit()
    assert client.get(f"/public/hostess/{token}").status_code == 410
    ev.event_date = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=5)
    db.commit()
    assert client.get(f"/public/hostess/{token}").status_code == 200


def test_venue_seating_export(client, db):
    from openpyxl import load_workbook
    owner, event_id, _ = _setup(db)
    r = client.get(f"/guests/export/seating?event_id={event_id}", headers=auth_header(owner))
    assert r.status_code == 200, r.text
    ws = load_workbook(io.BytesIO(r.content)).active
    rows = list(ws.iter_rows(values_only=True))
    assert rows[0][:7] == ("שם מלא", "שם פרטי", "שם משפחה", "טלפון", "קבוצה", "כמות מגיעים", "מספר שולחן")
    assert len(rows) == 2                       # only the confirmed invitation
    assert rows[1][:7] == ("דנה כהן", "דנה", "כהן", "050-1234567", "כלה", 4, 1)
    assert client.get(f"/guests/export/seating?event_id={event_id}",
                      headers=auth_header(uuid.uuid4())).status_code == 404
