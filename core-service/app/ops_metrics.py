"""Process-local operational metrics for the ops dashboard.

Two things the database cannot answer:

* API latency - a rolling in-memory window of recent request durations, fed by a
  middleware. Cheap (a bounded deque), real, and reset on restart - which is the
  correct scope for "how is THIS core process responding right now".
* Host resources - CPU / RAM / disk of the machine core runs on, via psutil when
  available. Honestly scoped: this is the core host, not every service's host
  (per-node metrics would need a node agent, out of scope here).
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Deque, Dict, Optional, Tuple

# Bounded so memory is constant; ~ the last few minutes of traffic.
_MAX_SAMPLES = 2000
_samples: Deque[Tuple[float, float]] = deque(maxlen=_MAX_SAMPLES)  # (ts, duration_ms)
_lock = threading.Lock()


def record_request(duration_ms: float) -> None:
    with _lock:
        _samples.append((time.time(), duration_ms))


def _percentile(sorted_vals, pct: float) -> float:
    if not sorted_vals:
        return 0.0
    k = max(0, min(len(sorted_vals) - 1, int(round((pct / 100.0) * (len(sorted_vals) - 1)))))
    return sorted_vals[k]


def latency_stats(window_seconds: int = 300) -> Dict[str, float]:
    """avg / p50 / p95 request latency over the recent window, plus rate."""
    cutoff = time.time() - window_seconds
    with _lock:
        recent = [d for (ts, d) in _samples if ts >= cutoff]
    if not recent:
        return {"count": 0, "avg_ms": 0.0, "p50_ms": 0.0, "p95_ms": 0.0, "rpm": 0.0}
    recent.sort()
    total = sum(recent)
    return {
        "count": len(recent),
        "avg_ms": round(total / len(recent), 1),
        "p50_ms": round(_percentile(recent, 50), 1),
        "p95_ms": round(_percentile(recent, 95), 1),
        "rpm": round(len(recent) / (window_seconds / 60.0), 1),
    }


def host_metrics() -> Dict[str, Optional[float]]:
    """CPU / RAM / disk of the core host. Nulls when psutil is unavailable."""
    try:
        import psutil
    except Exception:
        return {"available": False, "cpu_percent": None, "mem_percent": None,
                "mem_used_mb": None, "mem_total_mb": None,
                "disk_percent": None, "disk_used_gb": None, "disk_total_gb": None}
    try:
        vm = psutil.virtual_memory()
        du = psutil.disk_usage("/")
        return {
            "available": True,
            # interval=None -> non-blocking (delta since last call); fine for polling.
            "cpu_percent": round(psutil.cpu_percent(interval=None), 1),
            "mem_percent": round(vm.percent, 1),
            "mem_used_mb": round((vm.total - vm.available) / 1e6),
            "mem_total_mb": round(vm.total / 1e6),
            "disk_percent": round(du.percent, 1),
            "disk_used_gb": round(du.used / 1e9, 1),
            "disk_total_gb": round(du.total / 1e9, 1),
        }
    except Exception:
        return {"available": False, "cpu_percent": None, "mem_percent": None,
                "mem_used_mb": None, "mem_total_mb": None,
                "disk_percent": None, "disk_used_gb": None, "disk_total_gb": None}
