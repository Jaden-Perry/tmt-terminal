"""SQLite storage: a generic TTL cache plus a few structured tables."""
from __future__ import annotations

import json
import math
import sqlite3
import threading
import time
from contextlib import contextmanager
from typing import Any, Callable

from .config import DB_PATH

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS kv_cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    fetched_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS universe (
    ticker TEXT PRIMARY KEY,
    name TEXT,
    cik INTEGER,
    gics_sector TEXT,
    gics_sub_industry TEXT,
    sub_industry TEXT,
    source TEXT,
    market_cap REAL,
    updated_at REAL
);
CREATE TABLE IF NOT EXISTS prices (
    ticker TEXT NOT NULL,
    date TEXT NOT NULL,
    open REAL, high REAL, low REAL, close REAL, adj_close REAL, volume REAL,
    PRIMARY KEY (ticker, date)
);
CREATE TABLE IF NOT EXISTS metrics (
    ticker TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS watchlists (
    name TEXT NOT NULL,
    ticker TEXT NOT NULL,
    added_at REAL NOT NULL,
    PRIMARY KEY (name, ticker)
);
CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    cache_key TEXT
);
CREATE TABLE IF NOT EXISTS api_calls (
    source TEXT NOT NULL,
    day TEXT NOT NULL,
    n INTEGER NOT NULL,
    PRIMARY KEY (source, day)
);
CREATE TABLE IF NOT EXISTS news (
    id TEXT PRIMARY KEY,
    ticker TEXT,
    ts TEXT NOT NULL,
    headline TEXT NOT NULL,
    summary TEXT,
    source TEXT,
    url TEXT,
    provider TEXT,
    is_deal INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS news_ticker_ts ON news(ticker, ts);
CREATE INDEX IF NOT EXISTS news_ts ON news(ts);
CREATE TABLE IF NOT EXISTS ai_cache (
    key TEXT PRIMARY KEY,
    result TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS job_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job TEXT NOT NULL,
    started REAL NOT NULL,
    finished REAL,
    status TEXT,
    detail TEXT
);
"""


def conn() -> sqlite3.Connection:
    c = getattr(_local, "conn", None)
    if c is None:
        c = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        c.executescript(SCHEMA)
        _local.conn = c
    return c


@contextmanager
def tx():
    c = conn()
    try:
        yield c
        c.commit()
    except Exception:
        c.rollback()
        raise


def _clean(o: Any) -> Any:
    """Make values JSON-safe: NaN/inf become None."""
    if isinstance(o, float):
        return None if math.isnan(o) or math.isinf(o) else o
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if hasattr(o, "item") and callable(o.item):  # numpy scalar
        try:
            return _clean(o.item())
        except Exception:
            return None
    if hasattr(o, "isoformat"):
        return o.isoformat()
    return o


def dumps(o: Any) -> str:
    return json.dumps(_clean(o), separators=(",", ":"))


def cache_get(key: str, ttl: float | None = None) -> tuple[Any, float] | None:
    row = conn().execute("SELECT value, fetched_at FROM kv_cache WHERE key=?", (key,)).fetchone()
    if row is None:
        return None
    if ttl is not None and time.time() - row["fetched_at"] > ttl:
        return None
    return json.loads(row["value"]), row["fetched_at"]


def cache_set(key: str, value: Any) -> None:
    with tx() as c:
        c.execute(
            "INSERT OR REPLACE INTO kv_cache(key, value, fetched_at) VALUES (?,?,?)",
            (key, dumps(value), time.time()),
        )


HOUR = 3600
DAY = 86400
WEEK = 7 * DAY


def cached(key: str, ttl: float, fn: Callable[[], Any], *, force: bool = False) -> dict:
    """Return {"data", "fetched_at", "stale"}.

    If the fetch fails, fall back to the last stored value (marked stale) rather than erroring.
    A fetch returning None is not cached, so it is retried next time.
    """
    if not force:
        hit = cache_get(key, ttl)
        if hit is not None:
            return {"data": hit[0], "fetched_at": hit[1], "stale": False}
    try:
        data = fn()
    except Exception as e:  # noqa: BLE001 - any upstream failure falls back to cache
        old = cache_get(key)
        if old is not None:
            return {"data": old[0], "fetched_at": old[1], "stale": True, "error": str(e)[:200]}
        return {"data": None, "fetched_at": None, "stale": True, "error": str(e)[:200]}
    if data is not None:
        cache_set(key, data)
        return {"data": _clean(data), "fetched_at": time.time(), "stale": False}
    old = cache_get(key)
    if old is not None:
        return {"data": old[0], "fetched_at": old[1], "stale": True}
    return {"data": None, "fetched_at": None, "stale": False}
