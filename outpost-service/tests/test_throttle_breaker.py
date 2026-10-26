"""Standalone tests (stdlib only, no broker/DB): token bucket, circuit breaker,
Meta error classification, campaign log-state rule.

    cd outpost-service && python3 tests/test_throttle_breaker.py
"""
import asyncio
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from throttle import TokenBucket  # noqa: E402
from breaker import CircuitBreaker, CLOSED, OPEN, HALF_OPEN  # noqa: E402
import meta_errors  # noqa: E402

FAIL = 0


def check(name, cond):
    global FAIL
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}")
    FAIL += (not cond)


async def _rate_test():
    rate, n = 50.0, 60
    b = TokenBucket(rate, capacity=10)
    t0 = time.monotonic()
    await asyncio.gather(*(b.acquire() for _ in range(n)))
    elapsed = time.monotonic() - t0
    # 10 burst tokens, remaining 50 at 50/s -> ~1.0s. Never faster than the rate.
    expected = (n - 10) / rate
    check(f"bucket enforces rate (elapsed {elapsed:.2f}s >= {expected * 0.9:.2f}s)", elapsed >= expected * 0.9)
    check(f"bucket not pathologically slow (elapsed {elapsed:.2f}s < {expected * 1.6:.2f}s)",
          elapsed < expected * 1.6)


async def _priority_test():
    b = TokenBucket(20.0, capacity=1)
    order = []

    async def take(tag, prio, delay=0.0):
        await asyncio.sleep(delay)
        await b.acquire(priority=prio)
        order.append(tag)

    # 10 campaign waiters start first; 3 priority waiters arrive slightly later
    # and must still be served before most campaign waiters.
    tasks = [take(f"c{i}", False) for i in range(10)]
    tasks += [take(f"p{i}", True, delay=0.01) for i in range(3)]
    await asyncio.gather(*tasks)
    prio_positions = [order.index(f"p{i}") for i in range(3)]
    check(f"priority served first (positions {prio_positions})", max(prio_positions) <= 4)


def _fake_clock():
    t = [0.0]
    return t, (lambda: t[0])


def _breaker_test():
    t, clock = _fake_clock()
    br = CircuitBreaker(probe_interval=300, clock=clock)
    check("breaker starts closed", br.state == CLOSED and br.allow())
    check("first failure opens (returns True)", br.record_failure("meta_190") is True)
    check("open breaker denies", not br.allow())
    t[0] = 299
    check("still denies before probe interval", not br.allow())
    t[0] = 301
    check("probe permit granted after interval", br.allow() and br.state == HALF_OPEN)
    check("only ONE probe permit", not br.allow())
    check("failed probe re-opens (returns False: was not closed)", br.record_failure("meta_190") is False)
    check("re-opened denies", br.state == OPEN and not br.allow())
    t[0] = 700
    check("second probe granted", br.allow())
    br.release_probe()
    check("released probe can be re-taken", br.allow())
    check("successful probe closes (returns True)", br.record_success() is True and br.state == CLOSED)


def _meta_errors_test():
    e = meta_errors.from_response(400, {"error": {"code": 131056, "message": "pair rate limit"}})
    check("131056 retryable + error_code", e.kind == meta_errors.RETRYABLE and e.error_code == "meta_131056")
    check("190 account", meta_errors.from_response(401, {"error": {"code": 190}}).kind == meta_errors.ACCOUNT)
    check("368 account", meta_errors.from_response(400, {"error": {"code": 368}}).kind == meta_errors.ACCOUNT)
    check("132015 template", meta_errors.from_response(400, {"error": {"code": 132015}}).kind == meta_errors.TEMPLATE)
    check("131026 permanent", meta_errors.from_response(400, {"error": {"code": 131026}}).kind == meta_errors.PERMANENT)
    check("bare 503 retryable", meta_errors.from_response(503, None, "oops").kind == meta_errors.RETRYABLE)
    check("bare 503 code http_503", meta_errors.from_response(503, None).error_code == "http_503")
    check("transport retryable", meta_errors.from_transport(TimeoutError("t")).kind == meta_errors.RETRYABLE)


def _log_state_test():
    try:
        from rabbit_consumer import campaign_log_state
    except Exception as exc:  # aio_pika/httpx not installed locally
        print(f"  [SKIP] campaign_log_state ({exc})")
        return
    check("explicit log_state wins", campaign_log_state({"log_state": "rsvp_invite", "stage": "thank_you"}) == "rsvp_invite")
    check("legacy reminder key -> rsvp_invite", campaign_log_state({"state": "reminder__wedding"}) == "rsvp_invite")
    check("thank_you keeps current", campaign_log_state({"stage": "thank_you"}) is None)


if __name__ == "__main__":
    asyncio.run(_rate_test())
    asyncio.run(_priority_test())
    _breaker_test()
    _meta_errors_test()
    _log_state_test()
    print("FAILED" if FAIL else "ALL PASSED")
    sys.exit(1 if FAIL else 0)
