"""Owner call-round API (app/routers/call_rounds.py): event RBAC in core, the
rest forwarded to voice-service with the internal secret."""
from __future__ import annotations

import uuid

from shared.domain.roles import Role
from tests.conftest import auth_header, make_account_with_event


def test_rbac_and_forwarding(client, db, monkeypatch):
    from app.routers import call_rounds
    seen = []

    def fake_voice(method, path, json=None):
        seen.append((method, path, json))
        return {"rounds": [], "rounds_allowed": 3}
    monkeypatch.setattr(call_rounds, "_voice", fake_voice)

    owner, viewer = uuid.uuid4(), uuid.uuid4()
    _, eid = make_account_with_event(db, {owner: Role.OWNER.value, viewer: Role.VIEWER.value})
    assert client.get(f"/events/{eid}/call-rounds").status_code == 401
    assert client.get(f"/events/{eid}/call-rounds", headers=auth_header(uuid.uuid4())).status_code == 404
    assert client.get(f"/events/{eid}/call-rounds", headers=auth_header(owner)).json()["rounds_allowed"] == 3
    body = {"start_at": "2026-11-04T11:00:00+02:00"}
    assert client.post(f"/events/{eid}/call-rounds", json=body, headers=auth_header(viewer)).status_code == 403
    assert client.post(f"/events/{eid}/call-rounds", json=body, headers=auth_header(owner)).status_code == 201
    rid = uuid.uuid4()
    assert client.put(f"/events/{eid}/call-rounds/{rid}", json=body, headers=auth_header(owner)).status_code == 200
    assert client.post(f"/events/{eid}/call-rounds/{rid}/cancel", headers=auth_header(owner)).status_code == 200
    assert [m for m, _p, _j in seen] == ["GET", "POST", "PUT", "POST"]
    assert seen[1][2]["created_by"] == str(owner) and seen[3][1].endswith("/cancel")


def test_pressing_9_sends_the_invitation_with_rsvp_context(client, db, monkeypatch):
    """voice-service -> core: the guest's invitation goes out on the priority lane
    carrying event + guest, so the RSVP buttons answer for that guest."""
    import datetime as dt
    from app.models.models import Campaign, Event, Guest
    from app.routers import test_send
    sent = []
    monkeypatch.setattr(test_send, "publish_outpost_priority", lambda m: sent.append(m))
    monkeypatch.setenv("INTERNAL_API_SECRET", "s3cret")
    _, eid = make_account_with_event(db, {uuid.uuid4(): Role.OWNER.value})
    ev = db.get(Event, eid)
    ev.event_type, ev.event_date = "wedding", dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=20)
    ev.subjects = {"p1": "נועה", "p2": "יונתן", "role1": "bride", "role2": "groom"}
    g = Guest(id=uuid.uuid4(), event_id=eid, name="דנה כהן", phone="0501234567", status="invited")
    db.add(g)
    db.add(Campaign(event_id=str(eid), name="הזמנה", template="event_no_pic", channel="whatsapp", status="sent",
                    schedule_time=dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)))
    db.commit()
    body = {"event_id": str(eid), "guest_id": str(g.id)}
    assert client.post("/internal/voice/send-invitation", json=body).status_code in (401, 403)
    r = client.post("/internal/voice/send-invitation", json=body, headers={"X-Internal-Secret": "s3cret"})
    assert r.status_code == 200, r.text
    m = sent[0]
    assert m["recipient"].endswith("501234567") and m["event_id"] == str(eid) and m["guest_id"] == str(g.id)
    assert not m.get("campaign_id") and m["source"] == "voice_call"
    other = client.post("/internal/voice/send-invitation", json={**body, "guest_id": str(uuid.uuid4())},
                        headers={"X-Internal-Secret": "s3cret"})
    assert other.status_code == 404
