"""FRED official API (free key: https://fred.stlouisfed.org/docs/api/api_key.html, 120 requests/min)."""
from __future__ import annotations

import pandas as pd

from .. import ratelimit
from ..config import FRED_API_KEY
from .finnhub import NoKey
from .http import session


def available() -> bool:
    return bool(FRED_API_KEY)


def series(series_id: str, start: str = "2000-01-01") -> pd.Series:
    if not FRED_API_KEY:
        raise NoKey("FRED_API_KEY not set")
    ratelimit.wait("fred")
    ratelimit.count_call("fred")
    r = session().get("https://api.stlouisfed.org/fred/series/observations", timeout=30, params={
        "series_id": series_id, "api_key": FRED_API_KEY, "file_type": "json", "observation_start": start})
    if r.status_code == 400:
        raise RuntimeError(r.json().get("error_message", "FRED rejected the request")[:200])
    r.raise_for_status()
    obs = r.json().get("observations", [])
    s = pd.Series({o["date"]: float(o["value"]) for o in obs if o["value"] not in (".", "")}, dtype="float64")
    s.index = pd.to_datetime(s.index)
    return s
