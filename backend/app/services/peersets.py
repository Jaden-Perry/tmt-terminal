"""Saved peer sets per company (e.g. NVDA "AI peers"), chosen on the RV tab instead of the default comps.

Stored in SQLite so they survive restarts and cache clears. config/universe.yaml `peer_sets` seeds starter
sets once; deleting one in the app sticks.
"""
from __future__ import annotations

import json
import time

import yaml

from .. import db
from ..config import CONFIG_DIR
from . import universe

SCHEMA = """
CREATE TABLE IF NOT EXISTS peer_sets (ticker TEXT, name TEXT, tickers TEXT, updated REAL, PRIMARY KEY (ticker, name));
CREATE TABLE IF NOT EXISTS peer_set_active (ticker TEXT PRIMARY KEY, name TEXT);
"""
_ready = False


def _init() -> None:
    global _ready
    if _ready:
        return
    db.conn().executescript(SCHEMA)
    p = CONFIG_DIR / "universe.yaml"
    cfg = (yaml.safe_load(p.read_text()) or {}).get("peer_sets") or {} if p.exists() else {}
    seeded = set(map(tuple, (db.cache_get("peer_sets:seeded") or ([], 0))[0]))
    for t, sets in cfg.items():
        for name, tickers in (sets or {}).items():
            key = (str(t).upper(), str(name))
            if key not in seeded:
                save(key[0], key[1], tickers, _skip_init=True)
                seeded.add(key)
    db.cache_set("peer_sets:seeded", sorted(seeded))
    _ready = True


def _clean(tickers: list[str]) -> list[str]:
    out = []
    for t in tickers:
        t = universe._norm(str(t))
        if t and t not in out:
            out.append(t)
    return out


def get(ticker: str) -> dict:
    _init()
    ticker = ticker.upper()
    rows = db.conn().execute("SELECT name, tickers FROM peer_sets WHERE ticker=? ORDER BY updated", (ticker,)).fetchall()
    act = db.conn().execute("SELECT name FROM peer_set_active WHERE ticker=?", (ticker,)).fetchone()
    sets = [{"name": r["name"], "tickers": json.loads(r["tickers"])} for r in rows]
    u = universe.get(ticker) or {}
    default_name = "Hand-picked comps" if universe.peer_override(ticker) else f"All {u.get('sub_industry') or 'peers'}"
    active = act["name"] if act and any(s["name"] == act["name"] for s in sets) else None
    return {"default": {"name": default_name, "tickers": universe.peers(ticker)}, "sets": sets, "active": active}


def save(ticker: str, name: str, tickers: list[str], activate: bool = False, _skip_init: bool = False) -> dict | None:
    if not _skip_init:
        _init()
    ticker, name = ticker.upper(), name.strip()[:40]
    tickers = [t for t in _clean(tickers) if t != ticker]
    with db.tx() as c:
        c.execute("INSERT OR REPLACE INTO peer_sets(ticker, name, tickers, updated) VALUES (?,?,?,?)",
                  (ticker, name, json.dumps(tickers), time.time()))
        if activate:
            c.execute("INSERT OR REPLACE INTO peer_set_active(ticker, name) VALUES (?,?)", (ticker, name))
    return None if _skip_init else get(ticker)


def delete(ticker: str, name: str) -> dict:
    _init()
    ticker = ticker.upper()
    with db.tx() as c:
        c.execute("DELETE FROM peer_sets WHERE ticker=? AND name=?", (ticker, name))
        c.execute("DELETE FROM peer_set_active WHERE ticker=? AND name=?", (ticker, name))
    return get(ticker)


def set_active(ticker: str, name: str | None) -> dict:
    _init()
    ticker = ticker.upper()
    with db.tx() as c:
        if name:
            c.execute("INSERT OR REPLACE INTO peer_set_active(ticker, name) VALUES (?,?)", (ticker, name))
        else:
            c.execute("DELETE FROM peer_set_active WHERE ticker=?", (ticker,))
    return get(ticker)
