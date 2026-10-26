"""Async token bucket - keeps outpost under Meta's per-number throughput cap.

Meta allows ~80 messages/second per phone_number_id (Cloud API default). Outpost
now sends concurrently, so without a governor a 20-wide burst plus retries could
exceed that and earn 130429s. One bucket per phone_number_id, shared by both
lanes (campaign + priority) because Meta counts them together.

Priority acquirers take precedence: while any priority caller is waiting, a
normal (campaign) caller does not take a token, so an interactive reply never
queues behind a campaign burst inside this process.

Per process: with N outpost replicas set OUTPOST_MAX_MPS to (cap / N).
"""
from __future__ import annotations

import asyncio
import time
from typing import Callable, Dict, Optional


class TokenBucket:
    def __init__(self, rate: float, capacity: Optional[float] = None,
                 clock: Callable[[], float] = time.monotonic):
        if rate <= 0:
            raise ValueError("rate must be > 0")
        self.rate = float(rate)
        # Small burst: half a second of budget. Keeps the instantaneous rate
        # close to `rate` instead of allowing a full-second spike.
        self.capacity = float(capacity) if capacity else max(1.0, self.rate / 2.0)
        self._clock = clock
        self._tokens = self.capacity
        self._last = clock()
        self._priority_waiting = 0

    def _refill(self) -> None:
        now = self._clock()
        elapsed = now - self._last
        if elapsed > 0:
            self._tokens = min(self.capacity, self._tokens + elapsed * self.rate)
            self._last = now

    def try_acquire(self, priority: bool = False) -> bool:
        """Non-blocking take. Normal callers yield while priority callers wait."""
        self._refill()
        if self._tokens >= 1.0 and (priority or self._priority_waiting == 0):
            self._tokens -= 1.0
            return True
        return False

    async def acquire(self, priority: bool = False) -> None:
        if priority:
            self._priority_waiting += 1
        try:
            while True:
                if priority:
                    # Bypass the yield rule for ourselves.
                    self._refill()
                    if self._tokens >= 1.0:
                        self._tokens -= 1.0
                        return
                elif self.try_acquire(False):
                    return
                deficit = max(0.0, 1.0 - self._tokens)
                wait = deficit / self.rate if deficit else 0.0
                if not priority and self._priority_waiting:
                    wait = max(wait, 1.0 / self.rate)
                await asyncio.sleep(max(wait, 0.001))
        finally:
            if priority:
                self._priority_waiting -= 1


class BucketRegistry:
    """One bucket per phone_number_id, created lazily."""

    def __init__(self, rate: float, capacity: Optional[float] = None):
        self.rate = rate
        self.capacity = capacity
        self._buckets: Dict[str, TokenBucket] = {}

    def get(self, key: str) -> TokenBucket:
        b = self._buckets.get(key)
        if b is None:
            b = TokenBucket(self.rate, self.capacity)
            self._buckets[key] = b
        return b

    async def acquire(self, key: str, priority: bool = False) -> None:
        await self.get(key or "default").acquire(priority=priority)
