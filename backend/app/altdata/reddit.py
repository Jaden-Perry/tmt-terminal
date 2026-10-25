from __future__ import annotations

import datetime as dt
from collections import Counter

from .. import ratelimit
from ..sources.http import session
from . import AltSource


class RedditMentions(AltSource):
    id = "reddit"
    name = "Reddit mentions"
    description = ("Posts mentioning the ticker in investing subreddits over the last month, via Reddit's public JSON. "
                   "Capped at the 100 most recent posts, so it's a sample, not a full count. Unauthenticated access is "
                   "rate-limited and sometimes blocked.")
    proxy_for = "Retail investor chatter"
    unit = "posts/day (sample)"

    def series(self, ticker, company):
        ratelimit.wait("reddit")
        r = session().get("https://www.reddit.com/r/stocks+investing+wallstreetbets+StockMarket+options/search.json",
                          headers={"User-Agent": "TMT-Terminal/0.1 (personal research)"}, timeout=20,
                          params={"q": f"{ticker} OR \"{company}\"", "restrict_sr": "on", "sort": "new", "t": "month", "limit": 100})
        if r.status_code in (403, 429):
            raise RuntimeError(f"Reddit refused unauthenticated access (HTTP {r.status_code})")
        r.raise_for_status()
        days = Counter(dt.datetime.fromtimestamp(c["data"]["created_utc"], dt.UTC).date().isoformat()
                       for c in r.json().get("data", {}).get("children", []))
        start = dt.date.today() - dt.timedelta(days=30)
        return [{"date": (start + dt.timedelta(days=i)).isoformat(), "value": days.get((start + dt.timedelta(days=i)).isoformat(), 0)}
                for i in range(31)]
