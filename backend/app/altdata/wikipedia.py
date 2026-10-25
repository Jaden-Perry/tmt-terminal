from __future__ import annotations

import datetime as dt
import urllib.parse

from .. import db, ratelimit
from ..config import SEC_USER_AGENT
from ..sources.http import session
from . import AltSource


def _headers():
    # Wikimedia asks API clients for a descriptive User-Agent with contact info
    return {"User-Agent": f"TMT-Terminal/0.1 (personal research; {SEC_USER_AGENT or 'no contact set'})"}


def article_for(company: str) -> str | None:
    hit = db.cache_get(f"wiki:title:{company}")
    if hit:
        return hit[0]
    ratelimit.wait("wiki")
    r = session().get("https://en.wikipedia.org/w/api.php", headers=_headers(), timeout=20, params={
        "action": "query", "list": "search", "srsearch": f"{company} company", "srlimit": 1, "format": "json"})
    r.raise_for_status()
    res = r.json().get("query", {}).get("search", [])
    title = res[0]["title"] if res else None
    if title:
        db.cache_set(f"wiki:title:{company}", title)
    return title


class WikipediaPageviews(AltSource):
    id = "wikipedia"
    name = "Wikipedia pageviews"
    description = "Daily views of the company's English Wikipedia article (Wikimedia REST API)."
    proxy_for = "Retail / general public attention"
    unit = "views/day"

    def series(self, ticker, company):
        title = article_for(company)
        if not title:
            return []
        end = dt.date.today() - dt.timedelta(days=1)
        start = end - dt.timedelta(days=730)
        art = urllib.parse.quote(title.replace(" ", "_"), safe="")
        ratelimit.wait("wiki")
        r = session().get(
            f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/{art}/daily/"
            f"{start:%Y%m%d}00/{end:%Y%m%d}00", headers=_headers(), timeout=30)
        r.raise_for_status()
        return [{"date": f"{i['timestamp'][:4]}-{i['timestamp'][4:6]}-{i['timestamp'][6:8]}", "value": i["views"]}
                for i in r.json().get("items", [])]
