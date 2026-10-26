"""Consumer decision-flow tests with fakes (no broker / DB / Meta).

Needs the service deps importable (aio_pika, httpx); skips otherwise.

    cd outpost-service && python3 tests/test_consumer_flow.py
"""
import asyncio
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
os.environ.setdefault("WA_API_B", "x" * 20)
os.environ.setdefault("WA_PHONE_ID", "123")
os.environ.setdefault("RABBITMQ_PORT", "5672")

try:
    import rabbit_consumer as rc
    import meta_errors
    import db_utils
except Exception as exc:  # pragma: no cover
    print(f"SKIP: deps not importable ({exc})")
    sys.exit(0)

FAIL = 0


def check(name, cond):
    global FAIL
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")
    FAIL += (not cond)


class FakeMsg:
    def __init__(self, data, headers=None):
        self.body = json.dumps(data).encode()
        self.headers = headers or {}
        self.acked = self.requeued = False

    async def ack(self):
        self.acked = True

    async def nack(self, requeue=True):
        self.requeued = requeue


class FakeDB:
    enabled = True

    def __init__(self, claim=db_utils.CLAIM_OK):
        self.executor = ThreadPoolExecutor(2)
        self.claim = claim
        self.outcomes = []
        self.released = 0
        self.logged = []

    def claim_send(self, c, g):
        return self.claim

    def release_send_claim(self, c, g):
        self.released += 1

    def record_delivery_outcome(self, c, g, status, wamid=None, code=None, detail=None):
        if c and g:
            self.outcomes.append((status, wamid, code))
        return True

    def ensure_or_get_conversation(self, **kw):
        return "00000000-0000-0000-0000-000000000001"

    def get_conversation_state(self, cid):
        return "rsvp_decline"

    def log_outgoing_message(self, **kw):
        self.logged.append(kw)
        return True

    def ensure_schema(self):
        return True


class FakeSender:
    def __init__(self, behaviour):
        self.behaviour = behaviour
        self.calls = 0

    def phone_id_for(self, sender=None):
        return "123"

    async def _go(self):
        self.calls += 1
        b = self.behaviour
        if isinstance(b, Exception):
            raise b
        return {"messages": [{"id": "wamid.X"}]}

    async def send_template_message(self, **kw):
        return await self._go()

    async def send_text_message(self, **kw):
        return await self._go()

    async def send_interactive_message(self, **kw):
        return await self._go()


def make(behaviour, claim=db_utils.CLAIM_OK):
    c = rc.RabbitMQConsumer.__new__(rc.RabbitMQConsumer)
    # Manual init: fakes instead of the real sender / DB / broker.
    import logging
    c.logger = logging.getLogger("test")
    c.whatsapp_sender = FakeSender(behaviour)
    c.conversation_db = FakeDB(claim)
    c.max_attempts = 5
    c.campaign = rc.Lane("campaign", "q", 20, 20, False, [30, 120, 480, 1200, 2400])
    c.priority = rc.Lane("priority", "pq", 10, 10, True, [2, 10, 30, 120, 300])
    c.lanes = (c.campaign, c.priority)
    c.buckets = rc.BucketRegistry(1000)
    c.breaker = rc.CircuitBreaker(300)
    c.template_breakers = rc.KeyedBreakers(300)
    c._tasks = set()
    c._reported = {}
    c._stats = {"accepted": 0, "failed": 0, "retried": 0, "requeued": 0, "skipped": 0}
    c.published = []

    async def _publish(rk, body, headers, expiration=None):
        c.published.append((rk, headers, expiration))
    c._publish = _publish

    async def _pause(lane):
        lane.paused = True
    c._pause_lane = _pause

    async def _start(lane, prefetch=None):
        lane.paused = False
    c._start_lane = _start

    async def _alert(*a, **k):
        c.alerted = True
    c._alert_critical = _alert
    c.alerted = False
    return c


CAMPAIGN_MSG = {"platform": "WA", "message_type": "template", "recipient": "+972501234567",
                "template": "reminder__wedding", "parameters": {}, "campaign_id": "c1",
                "guest_id": "g1", "event_id": "00000000-0000-0000-0000-0000000000e1",
                "log_state": "rsvp_invite"}


async def run():
    # success
    c = make(None)
    m = FakeMsg(CAMPAIGN_MSG)
    await c._process(c.campaign, m)
    check("success: acked", m.acked)
    check("success: accepted recorded", c.conversation_db.outcomes == [("accepted", "wamid.X", None)])
    log = c.conversation_db.logged[0]
    check("success: logged with rsvp_invite (not current rsvp_decline)", log["state"] == "rsvp_invite")
    check("success: guest_phone logged", log["guest_phone"] == "+972501234567")

    # already resolved -> no send
    c = make(None, claim=db_utils.CLAIM_DONE)
    m = FakeMsg(CAMPAIGN_MSG)
    await c._process(c.campaign, m)
    check("dup: not sent", c.whatsapp_sender.calls == 0 and m.acked)

    # uncertain -> failed send_uncertain, no send
    c = make(None, claim=db_utils.CLAIM_UNCERTAIN)
    m = FakeMsg(CAMPAIGN_MSG)
    await c._process(c.campaign, m)
    check("uncertain: not sent + failed", c.whatsapp_sender.calls == 0 and
          c.conversation_db.outcomes[0][2] == "send_uncertain")

    # retryable -> retry queue tier 1, claim released, acked
    err = meta_errors.from_response(400, {"error": {"code": 131056}})
    c = make(err)
    m = FakeMsg(CAMPAIGN_MSG)
    await c._process(c.campaign, m)
    check("retryable: published to q.retry.1", c.published and c.published[0][0] == "q.retry.1")
    check("retryable: attempt header 1", c.published[0][1][rc.ATTEMPT_HEADER] == 1)
    check("retryable: jittered expiration in [24,36]", 24 <= c.published[0][2] <= 36)
    check("retryable: claim released + acked", c.conversation_db.released == 1 and m.acked)
    check("retryable: no failed outcome yet", c.conversation_db.outcomes == [])

    # retryable at last attempt -> failed with meta code
    c = make(err)
    m = FakeMsg(CAMPAIGN_MSG, headers={rc.ATTEMPT_HEADER: 4})
    await c._process(c.campaign, m)
    check("exhausted: failed meta_131056", c.conversation_db.outcomes and
          c.conversation_db.outcomes[0][0] == "failed" and c.conversation_db.outcomes[0][2] == "meta_131056")

    # permanent
    c = make(meta_errors.from_response(400, {"error": {"code": 131026}}))
    m = FakeMsg(CAMPAIGN_MSG)
    await c._process(c.campaign, m)
    check("permanent: failed immediately", c.conversation_db.outcomes[0][2] == "meta_131026" and not c.published)

    # account-level -> breaker open, campaign lane paused, message requeued, claim released
    c = make(meta_errors.from_response(401, {"error": {"code": 190}}))
    m = FakeMsg(CAMPAIGN_MSG)
    await c._process(c.campaign, m)
    check("account: breaker open", c.breaker.state == "open")
    check("account: campaign lane paused", c.campaign.paused)
    check("account: requeued (not failed)", m.requeued and not c.conversation_db.outcomes)
    check("account: claim released", c.conversation_db.released == 1)
    check("account: ops alerted", c.alerted)
    # next campaign message while open -> requeued without calling Meta
    calls = c.whatsapp_sender.calls
    m2 = FakeMsg(CAMPAIGN_MSG)
    await c._process(c.campaign, m2)
    check("open: requeued without send", m2.requeued and c.whatsapp_sender.calls == calls)
    # priority message while open -> retry queue, not dropped
    m3 = FakeMsg({"platform": "WA", "message_type": "free_text", "recipient": "972500000000", "text": "hi"})
    await c._process(c.priority, m3)
    check("open: priority deferred to pq.retry.1", c.published and c.published[-1][0] == "pq.retry.1")
    # probe succeeds -> closed + lane resumed
    c.breaker.opened_at -= 400
    c.whatsapp_sender.behaviour = None
    m4 = FakeMsg(CAMPAIGN_MSG)
    await c._process(c.campaign, m4)
    check("probe success: breaker closed + lane resumed", c.breaker.state == "closed" and not c.campaign.paused)

    # template-level -> template breaker, retry, alert
    c = make(meta_errors.from_response(400, {"error": {"code": 132015}}))
    m = FakeMsg(CAMPAIGN_MSG)
    await c._process(c.campaign, m)
    check("template: retried + alerted", c.published[0][0] == "q.retry.1" and c.alerted)
    calls = c.whatsapp_sender.calls
    m2 = FakeMsg(CAMPAIGN_MSG)
    await c._process(c.campaign, m2)
    check("template breaker open: no Meta call, retried", c.whatsapp_sender.calls == calls and
          c.published[-1][0] == "q.retry.1")
    check("template: global breaker untouched", c.breaker.state == "closed")


if __name__ == "__main__":
    asyncio.run(run())
    print("FAILED" if FAIL else "ALL PASSED")
    sys.exit(1 if FAIL else 0)
