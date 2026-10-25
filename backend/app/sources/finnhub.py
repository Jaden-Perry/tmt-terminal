"""Finnhub free tier (60 calls/min). Premium-only endpoints raise Paywalled so the UI can say so."""
from __future__ import annotations

import datetime as dt

from .. import ratelimit
from ..config import FINNHUB_API_KEY
from .http import session

BASE = "https://finnhub.io/api/v1"


class Paywalled(Exception):
    pass


class NoKey(Exception):
    pass


def available() -> bool:
    return bool(FINNHUB_API_KEY)


def get(path: str, **params):
    if not FINNHUB_API_KEY:
        raise NoKey("FINNHUB_API_KEY not set")
    ratelimit.wait("finnhub")
    ratelimit.count_call("finnhub")
    r = session().get(f"{BASE}{path}", params={**params, "token": FINNHUB_API_KEY}, timeout=30)
    if r.status_code in (401, 403):
        raise Paywalled(f"Finnhub {path} isn't included in the free tier")
    if r.status_code == 429:
        raise RuntimeError("Finnhub rate limit hit")
    r.raise_for_status()
    return r.json()


def recommendation_trends(ticker: str):
    return get("/stock/recommendation", symbol=ticker)


def earnings_surprises(ticker: str):
    return get("/stock/earnings", symbol=ticker)


def peers(ticker: str):
    return get("/stock/peers", symbol=ticker)


def basic_financials(ticker: str):
    return get("/stock/metric", symbol=ticker, metric="all")


def price_target(ticker: str):
    return get("/stock/price-target", symbol=ticker)


def company_news(ticker: str, days: int = 30):
    to = dt.date.today()
    # "from" is a Python keyword, so pass params as a dict
    return get("/company-news", **{"symbol": ticker, "from": (to - dt.timedelta(days=days)).isoformat(), "to": to.isoformat()})


def general_news(category: str = "general"):
    return get("/news", category=category)


def earnings_calendar(start: str, end: str, ticker: str | None = None):
    params = {"from": start, "to": end}
    if ticker:
        params["symbol"] = ticker
    return get("/calendar/earnings", **params)
