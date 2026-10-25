"""Pluggable alternative-data proxies.

To add a source: create a module in this package with a subclass of AltSource and add it to PLUGINS.
Each source returns a list of {"date": "YYYY-MM-DD", "value": float} for a company. All of them are
*proxies* for attention/interest, not measures of fundamentals, and the UI labels them that way.
"""
from __future__ import annotations

import re

from .. import db


FAIL_TTL = 6 * db.HOUR


class AltSource:
    id = "base"
    name = "Base"
    description = ""
    proxy_for = ""
    unit = ""
    ttl = db.DAY
    requires = None  # env var needed, if any

    def series(self, ticker: str, company: str) -> list[dict]:  # pragma: no cover - interface
        raise NotImplementedError


def plugins() -> list[AltSource]:
    from .gdelt_volume import GdeltVolume
    from .hackernews import HackerNews
    from .reddit import RedditMentions
    from .trends import GoogleTrends
    from .wikipedia import WikipediaPageviews

    return [WikipediaPageviews(), GdeltVolume(), HackerNews(), RedditMentions(), GoogleTrends()]


def fetch(ticker: str, company: str) -> list[dict]:
    out = []
    for p in plugins():
        meta = {"id": p.id, "name": p.name, "description": p.description, "proxy_for": p.proxy_for, "unit": p.unit}
        fail = db.cache_get(f"alt:fail:{p.id}:{ticker}", FAIL_TTL)
        if fail and db.cache_get(f"alt:{p.id}:{ticker}") is None:
            # Recently failed: don't make the page wait on a source that's refusing us
            out.append({**meta, "points": [], "status": f"{fail[0]} (retrying after 6h)", "fetched_at": None})
            continue
        res = db.cached(f"alt:{p.id}:{ticker}", p.ttl, lambda p=p: p.series(ticker, company) or None)
        status = "ok" if res["data"] else (f"Unavailable: {res['error']}" if res.get("error") else "No data returned")
        status = re.sub(r" for url: \S+", "", status)
        if not res["data"]:
            db.cache_set(f"alt:fail:{p.id}:{ticker}", status)
        if res.get("stale") and res["data"]:
            status = f"Stale (last refresh failed: {res.get('error', '')[:120]})"
        out.append({**meta, "points": res["data"] or [], "status": status, "fetched_at": res.get("fetched_at")})
    return out
