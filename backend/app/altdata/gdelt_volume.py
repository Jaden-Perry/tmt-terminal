from __future__ import annotations

import datetime as dt

from .. import ratelimit
from ..sources.gdelt import URL
from ..sources.http import session
from . import AltSource


class GdeltVolume(AltSource):
    id = "gdelt_volume"
    name = "Global news volume (GDELT)"
    description = "Share of all global online news articles mentioning the company, daily, last ~3 months."
    proxy_for = "Media attention / news flow intensity"
    unit = "% of coverage"

    def series(self, ticker, company):
        q = f'"{company}"' if " " in company else f'"{company}" ({ticker} OR stock OR shares)'
        ratelimit.wait("gdelt")
        r = session().get(URL, timeout=30, params={"query": f"{q} sourcelang:english", "mode": "timelinevol",
                                                    "format": "json", "timespan": "3months"})
        r.raise_for_status()
        if not r.text.strip().startswith("{"):
            raise RuntimeError(r.text.strip()[:120] or "empty response")
        tl = (r.json().get("timeline") or [{}])[0].get("data", [])
        out = {}
        for p in tl:
            d = dt.datetime.strptime(p["date"][:8], "%Y%m%d").date().isoformat()
            out[d] = out.get(d, 0) + float(p["value"])
        return [{"date": d, "value": v} for d, v in sorted(out.items())]
