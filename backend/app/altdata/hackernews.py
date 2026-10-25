from __future__ import annotations

import datetime as dt
import time

from .. import ratelimit
from ..sources.http import session
from . import AltSource


class HackerNews(AltSource):
    id = "hackernews"
    name = "Hacker News mentions"
    description = "Monthly count of Hacker News stories and comments mentioning the company (Algolia HN API)."
    proxy_for = "Developer / tech-community mindshare"
    unit = "mentions/month"
    ttl = 7 * 86400

    def series(self, ticker, company):
        out = []
        today = dt.date.today().replace(day=1)
        for i in range(18, -1, -1):
            start = (today - dt.timedelta(days=30 * i)).replace(day=1)
            end = (start + dt.timedelta(days=32)).replace(day=1)
            ratelimit.wait("wiki")  # Algolia is generous; reuse a light throttle
            r = session().get("https://hn.algolia.com/api/v1/search", timeout=20, params={
                "query": f'"{company}"', "hitsPerPage": 0,
                "numericFilters": f"created_at_i>={int(time.mktime(start.timetuple()))},created_at_i<{int(time.mktime(end.timetuple()))}"})
            r.raise_for_status()
            out.append({"date": start.isoformat(), "value": r.json().get("nbHits", 0)})
        return out
