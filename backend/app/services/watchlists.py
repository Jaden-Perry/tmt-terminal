"""Watchlists: seeded once from config/watchlists.yaml, then edited with the star button."""
from __future__ import annotations

import time

import yaml

from .. import db
from ..config import CONFIG_DIR

DEFAULT = "Fund Holdings"


def seed_from_config() -> None:
    p = CONFIG_DIR / "watchlists.yaml"
    if not p.exists():
        return
    cfg = yaml.safe_load(p.read_text()) or {}
    seeded = set(map(tuple, (db.cache_get("watchlists:seeded") or ([], 0))[0]))
    now = time.time()
    with db.tx() as c:
        for name, tickers in cfg.items():
            for t in tickers or []:
                key = (str(name), str(t).upper().strip())
                if key in seeded:
                    continue  # already seeded once; respect later removals via the star
                c.execute("INSERT OR IGNORE INTO watchlists(name, ticker, added_at) VALUES (?,?,?)", (*key, now))
                seeded.add(key)
    db.cache_set("watchlists:seeded", sorted(seeded))


def all_lists() -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for r in db.conn().execute("SELECT name, ticker FROM watchlists ORDER BY name, added_at"):
        out.setdefault(r["name"], []).append(r["ticker"])
    out.setdefault(DEFAULT, [])
    return out


def add(name: str, ticker: str) -> None:
    with db.tx() as c:
        c.execute("INSERT OR IGNORE INTO watchlists(name, ticker, added_at) VALUES (?,?,?)",
                  (name, ticker.upper(), time.time()))


def remove(name: str, ticker: str) -> None:
    with db.tx() as c:
        c.execute("DELETE FROM watchlists WHERE name=? AND ticker=?", (name, ticker.upper()))


def all_tickers() -> list[str]:
    return sorted({r[0] for r in db.conn().execute("SELECT DISTINCT ticker FROM watchlists")})
