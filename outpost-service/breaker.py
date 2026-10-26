"""Circuit breaker for account-level (and per-template) Meta failures.

A token that expired or an account Meta restricted fails EVERY send the same
way; before this, outpost marked the entire queue failed within minutes. The
breaker stops sending on the first such error and lets exactly one probe
through every `probe_interval` seconds until Meta accepts again.

    CLOSED     normal.
    OPEN       nothing is sent; callers park their message.
    HALF_OPEN  one probe in flight; its outcome closes or re-opens the breaker.

Single event loop, no locking needed.
"""
from __future__ import annotations

import time
from typing import Callable, Dict, Optional

CLOSED = "closed"
OPEN = "open"
HALF_OPEN = "half_open"


class CircuitBreaker:
    def __init__(self, probe_interval: float = 300.0, clock: Callable[[], float] = time.monotonic):
        self.probe_interval = float(probe_interval)
        self._clock = clock
        self.state = CLOSED
        self.opened_at: Optional[float] = None
        self.reason: Optional[str] = None
        self._probe_in_flight = False

    @property
    def is_closed(self) -> bool:
        return self.state == CLOSED

    def probe_due(self) -> bool:
        return (self.state == OPEN and self.opened_at is not None
                and self._clock() - self.opened_at >= self.probe_interval)

    def allow(self) -> bool:
        """May the caller send now? In HALF_OPEN only one caller gets a permit;
        it MUST report back via record_success/record_failure/release_probe."""
        if self.state == CLOSED:
            return True
        if self.state == OPEN and self.probe_due():
            self.state = HALF_OPEN
        if self.state == HALF_OPEN and not self._probe_in_flight:
            self._probe_in_flight = True
            return True
        return False

    def record_success(self) -> bool:
        """Returns True when this call closed a previously open breaker."""
        was_open = self.state != CLOSED
        self.state = CLOSED
        self.opened_at = None
        self.reason = None
        self._probe_in_flight = False
        return was_open

    def record_failure(self, reason: str) -> bool:
        """Trip (or re-trip). Returns True when this call opened a CLOSED breaker."""
        was_closed = self.state == CLOSED
        self.state = OPEN
        self.opened_at = self._clock()
        self.reason = reason
        self._probe_in_flight = False
        return was_closed

    def release_probe(self) -> None:
        """The permit holder ended without a verdict (e.g. message was a dup)."""
        self._probe_in_flight = False


class KeyedBreakers:
    """Independent breakers per key (template name)."""

    def __init__(self, probe_interval: float = 300.0):
        self.probe_interval = probe_interval
        self._b: Dict[str, CircuitBreaker] = {}

    def get(self, key: str) -> CircuitBreaker:
        b = self._b.get(key)
        if b is None:
            b = CircuitBreaker(self.probe_interval)
            self._b[key] = b
        return b

    def allow(self, key: Optional[str]) -> bool:
        if not key or key not in self._b:
            return True
        return self._b[key].allow()

    def record_success(self, key: Optional[str]) -> None:
        if key and key in self._b:
            self._b[key].record_success()
            del self._b[key]

    def record_failure(self, key: str, reason: str) -> bool:
        return self.get(key).record_failure(reason)

    def release_probe(self, key: Optional[str]) -> None:
        if key and key in self._b:
            self._b[key].release_probe()

    def in_half_open(self, key: Optional[str]) -> bool:
        """True when `key` is being probed (the caller that just passed allow()
        holds the probe permit)."""
        return bool(key) and key in self._b and self._b[key].state == HALF_OPEN

    def reason(self, key: Optional[str]) -> Optional[str]:
        return self._b[key].reason if key and key in self._b else None
