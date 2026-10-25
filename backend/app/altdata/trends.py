from __future__ import annotations

from .. import ratelimit
from . import AltSource


class GoogleTrends(AltSource):
    id = "google_trends"
    name = "Google Trends (search interest)"
    description = ("Relative weekly search interest (0-100) over 5 years via pytrends. pytrends is unofficial and "
                   "archived (2025); Google frequently returns 429 errors, so this source is best-effort.")
    proxy_for = "Consumer / product search interest"
    unit = "index 0-100"
    ttl = 7 * 86400

    def series(self, ticker, company):
        from pytrends.request import TrendReq

        ratelimit.wait("trends")
        tr = TrendReq(hl="en-US", tz=300, timeout=(10, 25))
        tr.build_payload([company], timeframe="today 5-y")
        df = tr.interest_over_time()
        if df is None or df.empty:
            return []
        return [{"date": d.strftime("%Y-%m-%d"), "value": float(v)} for d, v in df[company].items()]
