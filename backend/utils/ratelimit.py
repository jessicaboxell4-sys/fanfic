"""Tiny in-memory IP-keyed rate limiter.

Designed for endpoints that are unauthenticated and would otherwise be cheap
to brute-force (e.g. token enumeration on `/api/og/yib/{token}`). Single-
process FastAPI deployments only — restart wipes the state.

Why not slowapi? — pulls in limits + a redis option for our one use site;
this stays zero-dep and ~30 lines.
"""
from __future__ import annotations
import time
from collections import defaultdict, deque
from threading import Lock
from typing import Deque, Dict

from fastapi import HTTPException, Request


class SimpleRateLimiter:
    """Sliding-window rate limiter: at most `max_requests` per `window_seconds`."""

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max = max_requests
        self.win = window_seconds
        self._hits: Dict[str, Deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def check(self, key: str) -> None:
        """Record a hit for ``key``; raise 429 if it's over the limit."""
        now = time.time()
        with self._lock:
            q = self._hits[key]
            cutoff = now - self.win
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self.max:
                # Hint at retry window via Retry-After header.
                wait = max(1, int(self.win - (now - q[0])))
                raise HTTPException(
                    status_code=429,
                    detail="Too many requests",
                    headers={"Retry-After": str(wait)},
                )
            q.append(now)


def client_ip(request: Request) -> str:
    """Best-effort client IP behind Kubernetes ingress + Cloudflare."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    return request.client.host if request.client else "unknown"
