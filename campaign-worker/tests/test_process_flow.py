"""process_campaign decision tests with the DB/MQ layer faked out.

    cd campaign-worker && PYTHONPATH=.. python3 tests/test_process_flow.py
(needs the worker deps importable: psycopg2, pika, PyYAML; skips otherwise)
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

try:
    import worker
except Exception as exc:  # pragma: no cover
    print(f"SKIP: {exc}")
    sys.exit(0)

FAIL = 0


def check(name, cond):
    global FAIL
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")
    FAIL += (not cond)


class World:
    def __init__(self, campaign, event, guests, opted_out=(), has_messages=False, open_releases=False,
                 final_releases=()):
        self.campaign, self.event, self.guests = campaign, event, guests
        self.opted_out = set(opted_out)
        self.has_messages = has_messages
        self.open_releases = open_releases
        self.claimed, self.failed, self.published = [], [], []
        self.finished, self.status_set, self.completed = [], [], []
        self.releases_reverted, self.releases_failed, self.follow_ups = [], [], []
        self.final_releases = set(final_releases)
        self.parked = []

    def install(self):
        w = worker
        w.fetch_campaign_by_id = lambda conn, cid: self.campaign
        w.fetch_event_by_id = lambda conn, eid: self.event
        w.fetch_wa_template = lambda conn, ref: None
        w.fetch_replacement_ref = lambda conn, key, et: None
        w.select_guests_by_audience = lambda conn, eid, a, f: list(self.guests)
        w.guest_still_sendable = lambda conn, gid: gid not in self.opted_out
        w.claim_message = lambda conn, c, g: (self.claimed.append(g) or True)
        w.release_message_claim = lambda *a: None
        w.mark_message_failed = lambda conn, c, g, code, d: self.failed.append((g, code))
        w.publish_outpost = lambda ch, q, m: self.published.append(m)
        w.mark_release_sent = lambda *a: None
        w.campaign_has_open_releases = lambda conn, cid: self.open_releases
        w.campaign_has_messages = lambda conn, cid: self.has_messages or bool(self.claimed or self.failed)
        w.finish_campaign = lambda conn, cid, st, reason, recipient_count=None, only_if=None: \
            self.finished.append((st, reason, recipient_count))
        w.mark_campaign_status = lambda conn, cid, st: self.status_set.append(st)
        w.mark_campaign_completed = lambda conn, cid, n: self.completed.append(n)
        w.fail_open_releases = lambda conn, cid: self.releases_failed.append(cid)
        w.revert_release = lambda conn, rid: self.releases_reverted.append(rid)
        w.record_message_usage = lambda *a, **k: None
        w.create_follow_up_campaign = lambda conn, parent, h, a, recipient_count=0: \
            (self.follow_ups.append((a, recipient_count)) or "f1")
        w.release_is_final = lambda conn, rid: rid in self.final_releases
        w.park_campaign_no_guests = lambda conn, cid: self.parked.append(cid)
        w._record_ops = lambda *a, **k: None
        return self


FUTURE = datetime.now(timezone.utc) + timedelta(days=10)
PAST = datetime.now(timezone.utc) - timedelta(days=3)


def camp(**kw):
    c = {"id": "c1", "event_id": "e1", "name": "R", "template": "hello there friend",
         "template_key": None, "stage_id": "reminder", "variant_id": None,
         "custom_message": "Hi {guest_name}", "header_image_url": None, "channel": "whatsapp",
         "status": "processing", "audience": "everyone", "audience_filter": None,
         "follow_up_after_hours": None, "follow_up_audience": None, "campaign_type": None}
    c.update(kw)
    return c


def ev(**kw):
    e = {"id": "e1", "name": "E", "active": True, "event_date": FUTURE, "event_type": "wedding",
         "account_id": None, "inviters": [], "owners": []}
    e.update(kw)
    return e


G = [{"id": "g1", "name": "A", "phone": "050-1234567"},
     {"id": "g2", "name": "B", "phone": "052 7654321"},
     {"id": "g3", "name": "C", "phone": "12"}]

# happy path + normalization + opt-out + invalid phone + rsvp log_state
w = World(camp(), ev(), G, opted_out={"g2"}).install()
worker.process_campaign(None, None, "c1")
check("published only g1", [m["guest_id"] for m in w.published] == ["g1"])
check("recipient normalized to E.164", w.published and w.published[0]["recipient"] == "+972501234567")
check("opted-out g2 not claimed", "g2" not in w.claimed)
check("invalid phone recorded failed", ("g3", "invalid_phone") in w.failed)
check("reminder stage -> log_state rsvp_invite", w.published[0].get("log_state") == "rsvp_invite")
check("legacy path -> sending via mark_campaign_completed", w.completed == [1])

# empty audience -> sent with 0
w = World(camp(), ev(), []).install()
worker.process_campaign(None, None, "c1")
check("empty audience -> 'sent' rc 0", w.finished == [("sent", "empty audience", 0)])

# event passed -> failed (not thank_you)
w = World(camp(), ev(event_date=PAST), G).install()
worker.process_campaign(None, None, "c1")
check("event passed -> failed", w.finished and w.finished[0][0] == "failed" and not w.published)

# thank_you after the event is allowed
w = World(camp(stage_id="thank_you"), ev(event_date=PAST), G[:1]).install()
worker.process_campaign(None, None, "c1")
check("thank_you after event still sends", len(w.published) == 1)
check("thank_you not logged as rsvp_invite", "log_state" not in w.published[0])

# inactive event -> back to pending (legacy)
w = World(camp(), ev(active=False), G).install()
worker.process_campaign(None, None, "c1")
check("inactive event -> pending (not stuck processing)", w.finished and w.finished[0][0] == "pending")

# event not found -> failed
w = World(camp(), None, G).install()
worker.process_campaign(None, None, "c1")
check("event missing -> failed", w.finished and w.finished[0][0] == "failed")

# paused campaign on a release -> release reverted, nothing sent
w = World(camp(status="paused"), ev(), G).install()
worker.process_campaign(None, None, "c1", limit=5, release_id="r1")
check("paused campaign release -> reverted, not sent", w.releases_reverted == ["r1"] and not w.published)

# release path, more batches open -> stays pending, no follow-up yet
w = World(camp(status="pending", follow_up_after_hours=24, follow_up_audience="no_response"),
          ev(), G[:1], open_releases=True).install()
worker.process_campaign(None, None, "c1", limit=5, release_id="r1")
check("mid-plan batch: no status change", not w.status_set and not w.finished)
check("mid-plan batch: no follow-up", not w.follow_ups)

# last release -> sending + follow-up once
w = World(camp(status="pending", follow_up_after_hours=24, follow_up_audience="no_response"),
          ev(), G[:1], open_releases=False).install()
worker.process_campaign(None, None, "c1", limit=5, release_id="r2")
check("last batch -> sending", w.status_set == ["sending"])
check("last batch -> follow-up created", len(w.follow_ups) == 1)

# --- final batch sends ALL remaining eligible guests (stale planned count) ---
MANY = [{"id": f"m{i}", "name": f"N{i}", "phone": f"05012345{i:02d}"} for i in range(12)]
w = World(camp(status="pending"), ev(), MANY, open_releases=True).install()
worker.process_campaign(None, None, "c1", limit=5, release_id="r1")
check("non-final batch honours its limit (5)", len(w.published) == 5)
w = World(camp(status="pending"), ev(), MANY, final_releases={"r9"}).install()
worker.process_campaign(None, None, "c1", limit=5, release_id="r9")
check("final batch (is_final in DB) ignores limit -> all 12", len(w.published) == 12)
w = World(camp(status="pending"), ev(), MANY).install()
worker.process_campaign(None, None, "c1", limit=5, release_id="r8", final=True)
check("final batch (message flag) ignores limit -> all 12", len(w.published) == 12)

# --- 0-guest guard: invitation / save_the_date -> draft, not 'sent 0' ---
for st in ("invitation", "save_the_date"):
    w = World(camp(stage_id=st, status="pending"), ev(), []).install()
    worker.process_campaign(None, None, "c1", limit=1, release_id="r1")
    check(f"{st} with 0 guests -> parked (draft/no_guests)", w.parked == ["c1"])
    check(f"{st} with 0 guests -> not marked sent", not w.finished and not w.status_set)
w = World(camp(stage_id="invitation"), ev(), []).install()   # legacy path too
worker.process_campaign(None, None, "c1")
check("legacy invitation with 0 guests -> parked", w.parked == ["c1"] and not w.finished)
w = World(camp(stage_id="invitation", status="pending"), ev(), [], has_messages=True).install()
worker.process_campaign(None, None, "c1", limit=1, release_id="r1")
check("invitation already partly sent, 0 left -> normal completion (not parked)", not w.parked)
w = World(camp(stage_id="reminder"), ev(), []).install()
worker.process_campaign(None, None, "c1")
check("reminder with 0 guests keeps old behaviour (sent, 0)",
      not w.parked and w.finished == [("sent", "empty audience", 0)])

# --- Template Studio: an approved custom template (`custom__<key>`) ---
_CDOC = {"name": "garden_invite", "title": "הזמנה לגן", "group": "invitation", "language": "he",
         "category": "MARKETING", "header": {"type": "none"},
         "body": "היי {{guest_name}}, מוזמנים ל{{event_name}}. נשמח לראותכם!",
         "buttons": [{"type": "QUICK_REPLY", "text": "מגיעים!", "action": "rsvp_accepted"}]}
_CROW = {"key": "garden_invite", "doc": _CDOC, "version": 1, "archived": False, "meta_status": "approved",
         "live": {"status": "approved", "meta_name": "garden_invite", "doc": _CDOC, "version": 1}}
w = World(camp(template="custom__garden_invite", custom_message=None, stage_id=None), ev(), G[:1]).install()
_refs = []
worker.fetch_wa_template = lambda conn, ref: (_refs.append(ref) or (_CROW if ref == "custom__garden_invite" else None))
worker.process_campaign(None, None, "c1")
_m = w.published[0] if w.published else {}
check("custom template looked up by its ref", _refs == ["custom__garden_invite"])
check("custom template sent under its approved Meta name",
      _m.get("template") == "garden_invite" and _m.get("language") == "he")
check("custom template params resolved by VariableResolver",
      _m.get("parameters") == {"body": {"1": "A", "2": "E"}})
check("custom invitation -> stage + rsvp log_state", _m.get("stage") == "invitation" and _m.get("log_state") == "rsvp_invite")
# not approved (pending live) -> campaign fails instead of sending other copy
_pending = {**_CROW, "live": {**_CROW["live"], "status": "pending"}}
w = World(camp(template="custom__garden_invite", custom_message=None, stage_id=None), ev(), G[:1]).install()
worker.fetch_wa_template = lambda conn, ref: _pending
worker.process_campaign(None, None, "c1")
check("unapproved custom template is never sent", not w.published)
# missing row -> failed, never a stage-default fallback
w = World(camp(template="custom__nope", custom_message=None, stage_id=None, campaign_type="invitation"),
          ev(), G[:1]).install()
worker.process_campaign(None, None, "c1")
check("missing custom template -> failed, no fallback send",
      not w.published and w.finished and w.finished[0][0] == "failed")

# an edited built-in template: its approved Studio copy goes out instead
w = World(camp(template="reminder_friendly", custom_message=None, stage_id=None), ev(), G[:1]).install()
worker.fetch_replacement_ref = lambda conn, key, et: "custom__garden_invite" if key.startswith("reminder_friendly") else None
worker.fetch_wa_template = lambda conn, ref: _CROW if ref == "custom__garden_invite" else None
worker.process_campaign(None, None, "c1")
check("replaced built-in -> sends the approved copy", w.published and w.published[0].get("template") == "garden_invite")
worker.fetch_replacement_ref = lambda conn, key, et: None

# retry mode (Meta per-user marketing cap): only the asked guests, still unanswered,
# claimed via claim_retry; the round itself is not touched
RG = [{"id": "g1", "name": "A", "phone": "050-1234567", "status": "pending"},
      {"id": "g2", "name": "B", "phone": "052 7654321", "status": "attending"},
      {"id": "g4", "name": "D", "phone": "053 1111111", "status": "pending"}]
w = World(camp(status="sent"), ev(), RG).install()
_retried = []
worker.claim_retry = lambda conn, c, g: (_retried.append(g) or True)
worker.process_campaign(None, None, "c1", retry_guest_ids=["g1", "g2"])
check("retry sends only asked + unanswered guests", [m["guest_id"] for m in w.published] == ["g1"])
check("retry claims through claim_retry, not a new row", _retried == ["g1"] and not w.claimed)
check("retry leaves round status/usage alone", not (w.finished or w.status_set or w.completed or w.follow_ups))
w = World(camp(status="sent"), ev(), RG).install()
worker.claim_retry = lambda conn, c, g: False
worker.process_campaign(None, None, "c1", retry_guest_ids=["g1"])
check("retry already taken -> nothing sent", not w.published)
w = World(camp(status="paused"), ev(), RG).install()
worker.claim_retry = lambda conn, c, g: True
worker.process_campaign(None, None, "c1", retry_guest_ids=["g1"])
check("paused round -> no retry", not w.published)
w = World(camp(status="sent"), ev(event_date=PAST), RG).install()
worker.process_campaign(None, None, "c1", retry_guest_ids=["g1"])
check("event over -> no retry and round not failed", not w.published and not w.finished)

print("FAILED" if FAIL else "ALL PASSED")
sys.exit(1 if FAIL else 0)
