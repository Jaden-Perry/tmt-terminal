"""GDELT DOC 2.0 API (free, no key). Searches a rolling ~3-month window of global news."""
from __future__ import annotations

import datetime as dt
import re
import time

from .. import ratelimit
from .http import session

URL = "https://api.gdeltproject.org/api/v2/doc/doc"
WINDOW_DAYS = 90


def _clean(t: str) -> str:
    # GDELT tokenizes titles ("Nvidia 's rally , explained") - undo the spacing
    t = re.sub(r"\s+([,.!?;:%)'])", r"\1", t or "")
    return re.sub(r"([($])\s+", r"\1", t).strip()


def articles(query: str, start: dt.date | None = None, end: dt.date | None = None, max_records: int = 50,
             sort: str = "datedesc") -> list[dict]:
    params = {"query": f"{query} sourcelang:english", "mode": "artlist", "format": "json",
              "maxrecords": max_records, "sort": sort}
    if start:
        params["startdatetime"] = start.strftime("%Y%m%d000000")
    if end:
        params["enddatetime"] = end.strftime("%Y%m%d235959")
    for attempt in range(3):
        ratelimit.wait("gdelt")
        r = session().get(URL, params=params, timeout=30)
        if r.status_code != 429:
            break
        time.sleep(6 * (attempt + 1))  # GDELT allows ~1 request / 5s per IP
    r.raise_for_status()
    if not r.text.strip().startswith("{"):
        return []  # GDELT returns plain-text errors (e.g. query too short)
    out = []
    for a in r.json().get("articles", []):
        seen = a.get("seendate", "")
        try:
            ts = dt.datetime.strptime(seen, "%Y%m%dT%H%M%SZ").isoformat() + "Z"
        except ValueError:
            continue
        out.append({"headline": _clean(a.get("title")), "url": a.get("url"), "source": a.get("domain"), "ts": ts, "summary": None})
    return out


def in_window(d: dt.date) -> bool:
    return (dt.date.today() - d).days <= WINDOW_DAYS
