"""Host questions ("שאלות לאורחים"): field API, results endpoint, web RSVP answers."""
from __future__ import annotations

import uuid

from shared.domain.invite_token import make_guest_token
from shared.domain.roles import Role
from tests.conftest import auth_header, make_account_with_event, make_guest

SHUTTLE = {"label": "צריכים הסעה לאירוע?", "data_type": "enum",
           "options": ["כן, אשמח", "לא, תודה"], "ask_in_rsvp": True}


def _event(db, role=Role.OWNER.value):
    user = uuid.uuid4()
    _, event_id = make_account_with_event(db, {user: role})
    return user, event_id


def _set_guest(db, guest_id, **values):
    from app.models.models import Guest
    g = db.query(Guest).filter(Guest.id == str(guest_id)).first()
    for k, v in values.items():
        setattr(g, k, v)
    db.commit()


def test_create_question_without_key_and_flags(client, db):
    owner, event_id = _event(db)
    r = client.post(f"/events/{event_id}/fields", json=SHUTTLE, headers=auth_header(owner))
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["ask_in_rsvp"] is True
    assert body["key"].startswith("q_")
    assert body["options"] == ["כן, אשמח", "לא, תודה"]


def test_question_validation(client, db):
    owner, event_id = _event(db)
    h = auth_header(owner)
    one = {**SHUTTLE, "options": ["כן"]}
    assert client.post(f"/events/{event_id}/fields", json=one, headers=h).status_code == 422
    eleven = {**SHUTTLE, "options": [f"אפשרות {i}" for i in range(11)]}
    assert client.post(f"/events/{event_id}/fields", json=eleven, headers=h).status_code == 422
    long_button = {**SHUTTLE, "options": ["א" * 21, "ב"]}  # <=3 options -> 20 chars
    r = client.post(f"/events/{event_id}/fields", json=long_button, headers=h)
    assert r.status_code == 422 and "20" in r.json()["detail"]
    ok_list = {**SHUTTLE, "options": ["א" * 24, "ב", "ג", "ד"]}  # 4+ -> 24 chars
    assert client.post(f"/events/{event_id}/fields", json=ok_list, headers=h).status_code == 201
    dup = {**SHUTTLE, "options": ["כן", "כן"]}
    assert client.post(f"/events/{event_id}/fields", json=dup, headers=h).status_code == 422


def test_patch_question(client, db):
    owner, event_id = _event(db)
    h = auth_header(owner)
    fid = client.post(f"/events/{event_id}/fields", json=SHUTTLE, headers=h).json()["id"]
    r = client.patch(f"/events/{event_id}/fields/{fid}",
                     json={"label": "צריכים הסעה?", "options": ["כן", "לא", "אולי"], "sort_order": 3},
                     headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["label"] == "צריכים הסעה?" and r.json()["sort_order"] == 3
    r = client.patch(f"/events/{event_id}/fields/{fid}", json={"options": ["רק אחת"]}, headers=h)
    assert r.status_code == 422
    r = client.patch(f"/events/{event_id}/fields/{fid}", json={"ask_in_rsvp": False}, headers=h)
    assert r.status_code == 200 and r.json()["ask_in_rsvp"] is False


def test_viewer_cannot_create_but_can_read_results(client, db):
    owner = uuid.uuid4()
    viewer = uuid.uuid4()
    _, event_id = make_account_with_event(db, {owner: Role.OWNER.value, viewer: Role.VIEWER.value})
    assert client.post(f"/events/{event_id}/fields", json=SHUTTLE, headers=auth_header(viewer)).status_code == 403
    fid = client.post(f"/events/{event_id}/fields", json=SHUTTLE, headers=auth_header(owner)).json()["id"]
    assert client.get(f"/events/{event_id}/fields/{fid}/results", headers=auth_header(viewer)).status_code == 200
    assert client.get(f"/events/{event_id}/fields/{fid}/results",
                      headers=auth_header(uuid.uuid4())).status_code in (403, 404)


def test_results_endpoint(client, db):
    owner, event_id = _event(db)
    h = auth_header(owner)
    fid = client.post(f"/events/{event_id}/fields", json=SHUTTLE, headers=h).json()["id"]
    key = client.get(f"/events/{event_id}/fields", headers=h).json()[0]["key"]
    yes1 = make_guest(db, event_id, phone="+972500000001")
    yes2 = make_guest(db, event_id, phone="+972500000002")
    no1 = make_guest(db, event_id, phone="+972500000003")
    waiting = make_guest(db, event_id, phone="+972500000004")
    invited = make_guest(db, event_id, phone="+972500000005")
    for g in (yes1, yes2, no1):
        _set_guest(db, g, status="attending", guest_count=2)
    _set_guest(db, waiting, status="confirmed", guest_count=3)
    _set_guest(db, invited, status="invited")
    for g, v in ((yes1, "כן, אשמח"), (yes2, "כן, אשמח"), (no1, "לא, תודה")):
        assert client.put(f"/guests/{g}/custom", json={key: v}, headers=h).status_code == 200

    r = client.get(f"/events/{event_id}/fields/{fid}/results", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["field"]["id"] == fid
    assert body["total_answered"] == 3
    by_label = {o["label"]: o for o in body["options"]}
    assert by_label["כן, אשמח"]["count"] == 2 and by_label["כן, אשמח"]["people"] == 4
    assert by_label["לא, תודה"]["count"] == 1
    g0 = by_label["כן, אשמח"]["guests"][0]
    assert set(g0) >= {"id", "name", "phone_masked", "people"}
    assert "500000001" not in g0["phone_masked"]
    # Only CONFIRMED guests without an answer are "not answered yet".
    assert [g["id"] for g in body["unanswered_confirmed"]] == [str(waiting)]
    assert body["unanswered_confirmed"][0]["people"] == 3


def _publish(db, event_id, slug):
    from app.models.models import Event
    e = db.query(Event).filter(Event.id == event_id).first()
    e.public_slug = slug
    e.invitation_published = True
    db.commit()


def test_public_rsvp_questions_and_answers(client, db):
    owner, event_id = _event(db)
    h = auth_header(owner)
    fid = client.post(f"/events/{event_id}/fields", json=SHUTTLE, headers=h).json()["id"]
    client.post(f"/events/{event_id}/fields",
                json={"key": "internal", "label": "פנימי", "data_type": "enum", "options": ["a", "b"]}, headers=h)
    _publish(db, event_id, "q-test")

    view = client.get("/public/invite/q-test").json()
    assert [q["id"] for q in view["questions"]] == [fid]  # only ask_in_rsvp questions are public

    guest_id = make_guest(db, event_id, phone="+972500000009")
    token = make_guest_token(event_id, guest_id)
    r = client.post("/public/invite/q-test/rsvp", json={
        "token": token, "name": "Guest", "phone": "0500000009", "partySize": 2, "status": "confirmed",
        "answers": {fid: "כן, אשמח", str(uuid.uuid4()): "x"},
    })
    assert r.status_code == 201, r.text
    look = client.post("/public/invite/q-test/rsvp/lookup", json={"token": token}).json()
    assert look["answers"] == {fid: "כן, אשמח"}

    # Stale option is ignored, never fails the RSVP.
    r = client.post("/public/invite/q-test/rsvp", json={
        "token": token, "name": "Guest", "phone": "0500000009", "partySize": 2, "status": "confirmed",
        "answers": {fid: "אפשרות שנמחקה"},
    })
    assert r.status_code == 201
    assert client.post("/public/invite/q-test/rsvp/lookup", json={"token": token}).json()["answers"] == {fid: "כן, אשמח"}

    # New (untokened) confirming guest stores answers too; decliners don't.
    r = client.post("/public/invite/q-test/rsvp", json={
        "name": "New", "phone": "0500000010", "partySize": 1, "status": "confirmed", "answers": {fid: "לא, תודה"},
    })
    assert r.status_code == 201, r.text
    r = client.post("/public/invite/q-test/rsvp", json={
        "name": "Nope", "phone": "0500000011", "partySize": 1, "status": "declined", "answers": {fid: "כן, אשמח"},
    })
    assert r.status_code == 201
    res = client.get(f"/events/{event_id}/fields/{fid}/results", headers=h).json()
    assert res["total_answered"] == 2
