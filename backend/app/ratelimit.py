"""Per-source throttles so every free tier stays inside its limit."""
from __future__ import annotations

import datetime as dt
import threading
import time

from . import db


class Throttle:
    """Minimum spacing between calls (thread-safe)."""

    def __init__(self, min_interval: float):
        self.min_interval = min_interval
        self._lock = threading.Lock()
        self._last = 0.0

    def wait(self) -> None:
        with self._lock:
            delta = time.monotonic() - self._last
            if delta < self.min_interval:
                time.sleep(self.min_interval - delta)
            self._last = time.monotonic()


# Published limits (verified Oct 2026) and the spacing we use:
#   SEC EDGAR: 10 req/s            -> 0.15s
#   Finnhub free: 60 req/min       -> 1.1s
#   FRED: 120 req/min              -> 0.6s
#   FMP free: 250 req/day          -> daily budget below
#   Yahoo (yfinance): unpublished, IP-throttled -> 1.0s between single-ticker calls
#   GDELT DOC API: ~1 req / 5s     -> 5.5s
#   Wikipedia REST: generous       -> 0.2s
#   Reddit public JSON: ~10 req/min unauthenticated -> 6.5s
THROTTLES = {
    "sec": Throttle(0.15),
    "finnhub": Throttle(1.1),
    "fred": Throttle(0.6),
    "fmp": Throttle(0.5),
    "yahoo": Throttle(1.0),
    "gdelt": Throttle(5.5),
    "wiki": Throttle(0.2),
    "reddit": Throttle(6.5),
    "trends": Throttle(8.0),
}


def wait(source: str) -> None:
    THROTTLES[source].wait()


def _today() -> str:
    return dt.date.today().isoformat()


def count_call(source: str) -> int:
    with db.tx() as c:
        c.execute(
            "INSERT INTO api_calls(source, day, n) VALUES (?,?,1) "
            "ON CONFLICT(source, day) DO UPDATE SET n = n + 1",
            (source, _today()),
        )
        return c.execute("SELECT n FROM api_calls WHERE source=? AND day=?", (source, _today())).fetchone()[0]


def calls_today(source: str) -> int:
    row = db.conn().execute("SELECT n FROM api_calls WHERE source=? AND day=?", (source, _today())).fetchone()
    return row[0] if row else 0
