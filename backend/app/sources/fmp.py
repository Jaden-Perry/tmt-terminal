"""Financial Modeling Prep free tier (250 calls/day). Used only as a fallback, under a daily budget."""
from __future__ import annotations

from .. import ratelimit
from ..config import FMP_API_KEY, FMP_DAILY_BUDGET
from .finnhub import NoKey, Paywalled
from .http import session

BASE = "https://financialmodelingprep.com/stable"


class BudgetExhausted(Exception):
    pass


def available() -> bool:
    return bool(FMP_API_KEY) and ratelimit.calls_today("fmp") < FMP_DAILY_BUDGET


def get(path: str, **params):
    if not FMP_API_KEY:
        raise NoKey("FMP_API_KEY not set")
    if ratelimit.calls_today("fmp") >= FMP_DAILY_BUDGET:
        raise BudgetExhausted(f"FMP daily budget of {FMP_DAILY_BUDGET} calls used up; resets tomorrow")
    ratelimit.wait("fmp")
    ratelimit.count_call("fmp")
    r = session().get(f"{BASE}{path}", params={**params, "apikey": FMP_API_KEY}, timeout=30)
    if r.status_code in (401, 402, 403):
        raise Paywalled(f"FMP {path} isn't included in the free tier for this symbol")
    if r.status_code == 429:
        raise BudgetExhausted("FMP rate limit hit")
    r.raise_for_status()
    data = r.json()
    if isinstance(data, dict) and data.get("Error Message"):
        raise Paywalled(data["Error Message"][:200])
    return data


def analyst_estimates(ticker: str, period: str = "annual"):
    return get("/analyst-estimates", symbol=ticker, period=period, limit=10)


def price_target_consensus(ticker: str):
    return get("/price-target-consensus", symbol=ticker)


def grades_consensus(ticker: str):
    return get("/grades-consensus", symbol=ticker)
